import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePublicEndpoint, type PublicEndpoint } from '../common/network/public-endpoint';
import { executeGit, gitEnvironment } from './git-runtime';
import {
  assertTenantGitDirectory,
  createTenantGitCopy,
  decryptGitConnection,
  encryptGitConnection,
  gitTenantPath,
  validateGitRemote,
} from './git-tenant-storage';
import { validateLegacyGitSource } from './migrate-tenant-git';

jest.mock('../common/network/public-endpoint', () => ({ resolvePublicEndpoint: jest.fn() }));
jest.mock('./git-runtime', () => ({ ...jest.requireActual('./git-runtime'), executeGit: jest.fn() }));
jest.mock('./git-https-proxy', () => ({
  withGitHttpsTunnel: jest.fn(async (_endpoint: PublicEndpoint, callback: (proxy: string) => Promise<Buffer>) =>
    callback('http://127.0.0.1:9876'),
  ),
}));

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const repositoryKey = '33333333-3333-4333-8333-333333333333';

describe('tenant Git boundary', () => {
  const originalEnv = { ...process.env };
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nervion-git-boundary-'));
    process.env.GIT_TENANT_ROOT = root;
    process.env.GIT_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.GIT_ALLOWED_HOSTS = 'github.com';
    jest
      .mocked(resolvePublicEndpoint)
      .mockResolvedValue({ url: new URL('https://github.com/team/repo.git'), address: '140.82.114.3', family: 4 });
    jest.mocked(executeGit).mockImplementation(async (args) => {
      if (args[0] === '--version') return Buffer.from('git version 2.48.1\n');
      if (args.includes('--show-object-format')) return Buffer.from('sha1\n');
      if (args[0] === 'clone') {
        const target = args[args.length - 1];
        await mkdir(join(target, 'objects'), { recursive: true });
        await mkdir(join(target, 'refs'));
      }
      return Buffer.alloc(0);
    });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('never resolves a numeric repository ID into another tenant directory', () => {
    expect(gitTenantPath(tenantA, repositoryKey)).not.toBe(gitTenantPath(tenantB, repositoryKey));
    expect(() => gitTenantPath('../other', repositoryKey)).toThrow();
    expect(() => gitTenantPath(tenantA, '../../outside')).toThrow();
  });

  it('binds encrypted credentials to both tenant and generated repository key', () => {
    const connection = { remoteUrl: 'https://github.com/team/repo.git', username: 'reader', token: 'sensitive-pat' };
    const encrypted = encryptGitConnection(connection, tenantA, repositoryKey);
    expect(encrypted).not.toContain(connection.token);
    expect(decryptGitConnection(encrypted, tenantA, repositoryKey)).toEqual(connection);
    expect(() => decryptGitConnection(encrypted, tenantB, repositoryKey)).toThrow();
    expect(() => decryptGitConnection(encrypted, tenantA, tenantB)).toThrow();
    expect(() => decryptGitConnection(`${encrypted}x`, tenantA, repositoryKey)).toThrow();
  });

  it.each([
    'git@github.com:team/repo.git',
    'file:///etc/passwd',
    'ssh://github.com/team/repo',
    'git://github.com/team/repo.git',
    'https://token@github.com/team/repo.git',
    'https://github.com:8443/team/repo.git',
    'https://github.com/team/repo?token=x',
    'https://github.com/team/repo#ref',
    'https://github.com/team/repo%0a',
    'https://github.com/team/$(id)',
    'https://github.com/team/repo\\other',
  ])('rejects unsafe clone address %s', (url) => {
    expect(() => validateGitRemote(url)).toThrow();
  });

  it.each([...Array.from({ length: 32 }, (_, code) => code), 127])('rejects raw ASCII control code %i in a clone URL', (code) => {
    expect(() => validateGitRemote(`https://github.com/team/repo${String.fromCharCode(code)}`)).toThrow();
  });

  it.each([
    ['reader:other', 'pat'],
    ['reader\u0000', 'pat'],
    ['reader\u001f', 'pat'],
    ['reader\u007f', 'pat'],
    ['reader', 'pat\u0000'],
    ['reader', 'pat\u001f'],
    ['reader', 'pat\u007f'],
  ])('rejects unsafe credential characters without a clone', async (username, token) => {
    await expect(
      createTenantGitCopy(tenantA, { remoteUrl: 'https://github.com/team/repo.git', username, token }),
    ).rejects.toThrow('учетные данные');
    expect(jest.mocked(executeGit).mock.calls.some(([args]) => args[0] === 'clone')).toBe(false);
  });

  it('pins the verified IP and keeps authentication out of URLs and arguments', async () => {
    await createTenantGitCopy(tenantA, { remoteUrl: 'https://github.com/team/repo.git', username: 'reader', token: 'pat' });
    const invocation = jest.mocked(executeGit).mock.calls.find(([args]) => args[0] === 'clone');
    if (!invocation?.[1]) throw new Error('Missing clone invocation');
    const env = invocation[1];
    expect(resolvePublicEndpoint).toHaveBeenCalledWith('https://github.com/team/repo.git', {
      allowedHosts: ['github.com'],
      protocols: ['https:'],
    });
    const settings = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, index) => [
      env[`GIT_CONFIG_KEY_${index}`],
      env[`GIT_CONFIG_VALUE_${index}`],
    ]);
    expect(settings).toContainEqual(['http.curloptResolve', 'github.com:443:140.82.114.3']);
    expect(settings).toContainEqual(['http.followRedirects', 'false']);
    expect(settings).toContainEqual(['http.proxy', 'http://127.0.0.1:9876']);
    expect(settings).toContainEqual(['http.extraHeader', `Authorization: Basic ${Buffer.from('reader:pat').toString('base64')}`]);
    expect(env.GIT_ALLOW_PROTOCOL).toBe('https');
    expect(executeGit).toHaveBeenCalledWith(['--version']);
  });

  it('supports pinned public IPv6 without enabling a second DNS lookup', async () => {
    jest
      .mocked(resolvePublicEndpoint)
      .mockResolvedValue({ url: new URL('https://github.com/team/repo.git'), address: '2606:50c0:8000::154', family: 6 });
    await createTenantGitCopy(tenantA, { remoteUrl: 'https://github.com/team/repo.git', username: '', token: '' });
    const invocation = jest.mocked(executeGit).mock.calls.find(([args]) => args[0] === 'clone');
    if (!invocation?.[1]) throw new Error('Missing clone invocation');
    const env = invocation[1];
    expect(Object.values(env)).toContain('github.com:443:[2606:50c0:8000::154]');
  });

  it('rejects an old Git that might not support the required network controls', async () => {
    jest.mocked(executeGit).mockResolvedValue(Buffer.from('git version 2.30.0\n'));
    await expect(
      createTenantGitCopy(tenantA, { remoteUrl: 'https://github.com/team/repo.git', username: '', token: '' }),
    ).rejects.toThrow();
  });

  it('does not inherit operator credentials, Git tracing, SSH agents or proxy variables', () => {
    process.env.HTTPS_PROXY = 'http://proxy.invalid';
    process.env.GIT_TRACE_CURL = '1';
    process.env.SSH_AUTH_SOCK = '/tmp/agent';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    const env = gitEnvironment();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.GIT_TRACE_CURL).toBeUndefined();
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(env.HOME).toBe('/nonexistent');
  });

  it('fails closed for legacy paths and symlinks instead of reading a global fallback', async () => {
    const target = gitTenantPath(tenantA, repositoryKey);
    const other = join(root, 'other-repo');
    await mkdir(other);
    await mkdir(join(root, 'tenants', tenantA, repositoryKey), { recursive: true });
    await symlink(other, target);
    await expect(assertTenantGitDirectory(tenantA, other)).rejects.toThrow();
    await expect(assertTenantGitDirectory(tenantA, target)).rejects.toThrow();
    await expect(assertTenantGitDirectory(tenantB, target)).rejects.toThrow();
  });

  it('requires an explicit migration source root and rejects object alternates', async () => {
    const source = join(root, 'legacy', 'repo.git');
    await mkdir(join(source, 'objects', 'info'), { recursive: true });
    expect(await validateLegacyGitSource(source, [join(root, 'legacy')])).toBe(0);
    await expect(validateLegacyGitSource(source, [join(root, 'elsewhere')])).rejects.toThrow();
    await writeFile(join(source, 'objects', 'info', 'alternates'), '/another/tenant/objects');
    await expect(validateLegacyGitSource(source, [join(root, 'legacy')])).rejects.toThrow();
  });
});
