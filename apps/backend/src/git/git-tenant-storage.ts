import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { resolvePublicEndpoint, type PublicEndpoint } from '../common/network/public-endpoint';
import { directoryBytes, executeGit, gitEnvironment } from './git-runtime';
import { withGitHttpsTunnel } from './git-https-proxy';
import { assertNoExternalGitCleanup } from './git-external-readonly';

export interface GitConnection {
  remoteUrl: string | null;
  username: string;
  token: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n';

export function gitTenantPath(tenantId: string, repositoryKey: string): string {
  if (!UUID.test(tenantId) || !UUID.test(repositoryKey))
    throw new BadRequestException('Некорректный идентификатор Git-хранилища');
  const root = process.env.GIT_TENANT_ROOT?.trim();
  if (!root || !isAbsolute(root) || resolve(root) === sep || resolve(root) !== root || root === process.env.HOME) {
    throw new ServiceUnavailableException('Git-хранилище не настроено');
  }
  return join(root, 'tenants', tenantId.toLowerCase(), repositoryKey.toLowerCase(), 'repository.git');
}

function credentialKey(): Buffer {
  const value = process.env.GIT_CREDENTIAL_KEY ?? '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new ServiceUnavailableException('Ключ шифрования Git не настроен');
  }
  return key;
}

export function encryptGitConnection(connection: GitConnection, tenantId: string, repositoryKey: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), nonce);
  cipher.setAAD(Buffer.from(`${tenantId}/${repositoryKey}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(connection), 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64')).join('.');
}

export function decryptGitConnection(value: string, tenantId: string, repositoryKey: string): GitConnection {
  try {
    const chunks = value.split('.');
    if (chunks.length !== 3) throw new Error('Invalid envelope');
    const [nonce, tag, ciphertext] = chunks.map((chunk) => {
      const decoded = Buffer.from(chunk, 'base64');
      if (!chunk || decoded.toString('base64') !== chunk) throw new Error('Invalid envelope');
      return decoded;
    });
    if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', credentialKey(), nonce);
    decipher.setAAD(Buffer.from(`${tenantId}/${repositoryKey}`));
    decipher.setAuthTag(tag);
    const connection = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as GitConnection;
    if (
      (connection.remoteUrl !== null && typeof connection.remoteUrl !== 'string') ||
      typeof connection.username !== 'string' ||
      typeof connection.token !== 'string'
    ) {
      throw new Error('Invalid connection');
    }
    return connection;
  } catch {
    throw new ServiceUnavailableException('Не удалось открыть настройки подключения Git');
  }
}

export function validateGitRemote(rawUrl: string): URL {
  if (rawUrl.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(rawUrl))
    throw new BadRequestException('Укажите HTTPS-адрес репозитория');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Укажите HTTPS-адрес репозитория');
  }
  // A restrictive path also keeps the copyable clone command free of shell syntax.
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+(?:\.git)?$/.test(url.pathname) ||
    url.pathname.split('/').some((part) => part === '.' || part === '..') ||
    rawUrl.includes('%')
  ) {
    throw new BadRequestException('Нужен HTTPS-адрес без логина, пароля, параметров и нестандартного порта');
  }
  return url;
}

async function prepareGitNetwork(connection: GitConnection): Promise<{ env: NodeJS.ProcessEnv; endpoint: PublicEndpoint }> {
  if (!connection.remoteUrl) throw new BadRequestException('Для этого репозитория не настроен удаленный источник');
  const url = validateGitRemote(connection.remoteUrl);
  const hosts = (process.env.GIT_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const endpoint = await resolvePublicEndpoint(url.href, { allowedHosts: hosts, protocols: ['https:'] });
  const version = (await executeGit(['--version'])).toString('utf8').match(/^git version (\d+)\.(\d+)/);
  if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 45)) {
    throw new ServiceUnavailableException('Для безопасного HTTPS-подключения требуется Git 2.45 или новее');
  }
  const address = endpoint.family === 6 ? `[${endpoint.address}]` : endpoint.address;
  const settings: Array<[string, string]> = [['http.curloptResolve', `${url.hostname}:443:${address}`]];
  if (connection.token) {
    if (!connection.username || /[:\x00-\x1f\x7f]/.test(connection.username) || /[\x00-\x1f\x7f]/.test(connection.token)) {
      throw new BadRequestException('Некорректные учетные данные Git');
    }
    settings.push([
      'http.extraHeader',
      `Authorization: Basic ${Buffer.from(`${connection.username}:${connection.token}`).toString('base64')}`,
    ]);
  }
  return { env: gitEnvironment(settings), endpoint };
}

async function executeNetworkGit(
  args: string[],
  network: { env: NodeJS.ProcessEnv; endpoint: PublicEndpoint },
  quota: { directory: string; bytes: number },
): Promise<Buffer> {
  return withGitHttpsTunnel(network.endpoint, async (proxyUrl) => {
    const count = Number(network.env.GIT_CONFIG_COUNT);
    const env = {
      ...network.env,
      GIT_CONFIG_COUNT: String(count + 1),
      [`GIT_CONFIG_KEY_${count}`]: 'http.proxy',
      [`GIT_CONFIG_VALUE_${count}`]: proxyUrl,
    };
    return executeGit(args, env, quota);
  });
}

async function noSymlinkAncestors(path: string): Promise<void> {
  const resolved = await realpath(path);
  if (resolved !== resolve(path)) throw new BadRequestException('Символические ссылки в Git-хранилище запрещены');
}

export async function assertTenantGitDirectory(tenantId: string, gitdir: string): Promise<string> {
  const repositoryKey = dirname(gitdir).split(sep).pop() ?? '';
  if (gitdir !== gitTenantPath(tenantId, repositoryKey))
    throw new BadRequestException('Репозиторий требует переноса в хранилище пространства');
  try {
    await noSymlinkAncestors(gitdir);
    if (!(await lstat(gitdir)).isDirectory()) throw new Error('Not a directory');
    // Only our generated minimal configuration is trusted. No includes, remotes,
    // alternates, lazy-fetch config or hooks can enter through a legacy gitdir.
    if ((await readFile(join(gitdir, 'config'), 'utf8')) !== SAFE_CONFIG) throw new Error('Untrusted configuration');
    for (const path of ['objects', 'refs']) await noSymlinkAncestors(join(gitdir, path));
    for (const path of [
      'objects/info/alternates',
      'objects/info/http-alternates',
      'commondir',
      'gitdir',
      'config.worktree',
      'shallow',
    ]) {
      const stat = await lstat(join(gitdir, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat) throw new Error('Unsupported repository layout');
    }
  } catch {
    throw new ServiceUnavailableException('Git-хранилище недоступно или требует безопасной миграции');
  }
  return repositoryKey;
}

export async function readGitConnection(tenantId: string, gitdir: string): Promise<GitConnection> {
  const key = await assertTenantGitDirectory(tenantId, gitdir);
  const file = join(dirname(gitdir), 'connection.enc');
  await noSymlinkAncestors(file);
  return decryptGitConnection(await readFile(file, 'utf8'), tenantId, key);
}

export function gitRepositoryLimit(): number {
  const limit = Number(process.env.GIT_MAX_REPO_BYTES || 536870912);
  if (!Number.isSafeInteger(limit) || limit < 1048576 || limit > 10737418240)
    throw new ServiceUnavailableException('Некорректный лимит Git-хранилища');
  return limit;
}

export async function removeTenantGitCopy(tenantId: string, gitdir: string): Promise<void> {
  assertNoExternalGitCleanup(gitdir);
  const key = dirname(gitdir).split(sep).pop() ?? '';
  if (gitdir !== gitTenantPath(tenantId, key)) throw new Error('Invalid Git cleanup target');
  const parent = await lstat(dirname(gitdir)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!parent) return;
  await noSymlinkAncestors(dirname(gitdir));
  await rm(dirname(gitdir), { recursive: true, force: false });
}

/** The source may be HTTPS or an explicitly authorized offline migration path. */
export async function createTenantGitCopy(
  tenantId: string,
  connection: GitConnection,
  migrationSource?: string,
  refresh = false,
  onAllocated?: (gitdir: string) => void,
): Promise<string> {
  const repositoryKey = randomUUID();
  const gitdir = gitTenantPath(tenantId, repositoryKey);
  assertNoExternalGitCleanup(gitdir);
  const encrypted = encryptGitConnection(connection, tenantId, repositoryKey);
  const network = migrationSource ? null : await prepareGitNetwork(connection);
  const tenantRoot = dirname(dirname(gitdir));
  await mkdir(tenantRoot, { recursive: true, mode: 0o700 });
  await noSymlinkAncestors(tenantRoot);
  const tenantLimit = Number(process.env.GIT_MAX_TENANT_BYTES || 2147483648);
  if (!Number.isSafeInteger(tenantLimit) || tenantLimit < 1048576 || tenantLimit > 137438953472) {
    throw new ServiceUnavailableException('Некорректный лимит Git-хранилища пространства');
  }
  const remaining = tenantLimit - (await directoryBytes(tenantRoot));
  if (remaining < 1048576) throw new BadRequestException('Git-хранилище пространства заполнено');
  const quota = { directory: dirname(gitdir), bytes: Math.min(gitRepositoryLimit(), remaining) };
  await mkdir(dirname(gitdir), { mode: 0o700 });
  try {
    onAllocated?.(gitdir);
    const cloneArgs = [
      'clone',
      '--bare',
      '--no-local',
      '--no-hardlinks',
      '--template=',
      '--',
      migrationSource ?? connection.remoteUrl!,
      gitdir,
    ];
    if (network) await executeNetworkGit(cloneArgs, network, quota);
    else await executeGit(cloneArgs, gitEnvironment([], 'file'), quota);
    if ((await directoryBytes(gitdir)) > quota.bytes) throw new BadRequestException('Репозиторий превышает лимит хранилища');
    const format = (await executeGit(['--git-dir', gitdir, 'rev-parse', '--show-object-format'])).toString('utf8').trim();
    if (format !== 'sha1') throw new BadRequestException('Поддерживаются репозитории Git с SHA-1');
    await writeFile(join(gitdir, 'config'), SAFE_CONFIG, { mode: 0o600 });
    await writeFile(join(dirname(gitdir), 'connection.enc'), encrypted, { mode: 0o600, flag: 'wx' });
    await assertTenantGitDirectory(tenantId, gitdir);
    if (refresh) {
      const fetchNetwork = await prepareGitNetwork(connection);
      await executeNetworkGit(
        [
          '--git-dir',
          gitdir,
          'fetch',
          '--atomic',
          '--prune',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          '--',
          connection.remoteUrl!,
          '+refs/heads/*:refs/heads/*',
          '+refs/tags/*:refs/tags/*',
        ],
        fetchNetwork,
        quota,
      );
      if ((await directoryBytes(gitdir)) > quota.bytes) throw new BadRequestException('Репозиторий превышает лимит хранилища');
    }
    return gitdir;
  } catch (error) {
    await removeTenantGitCopy(tenantId, gitdir);
    throw error;
  }
}
