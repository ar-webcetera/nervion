import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { JsonValue } from '@tracker/contracts';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { executeGit, gitEnvironment } from './git-runtime';

interface ExternalGitConfiguration {
  root: string;
  repositories: ExternalGitRepositoryConfiguration[];
}

interface ExternalGitRepositoryConfiguration {
  tenantId: string;
  repositoryId: number;
  gitdir: string;
  cloneUrl: string | null;
}

interface MetadataFile {
  path: string;
  contents: Buffer;
}

interface RepositorySnapshot {
  objects: string;
  files: MetadataFile[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tbare = true\n';
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_FILES = 25_000;
const MAX_ENTRIES = 250_000;
const MAX_METADATA_TIME_MS = 5_000;
const MAX_CONCURRENT_INSPECTIONS = 4;
const MAX_PENDING_INSPECTIONS = 32;
let activeInspections = 0;
const inspectionWaiters: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = [];

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('Внешний репозиторий недоступен. Обратитесь к администратору');
}

function inside(root: string, path: string): boolean {
  return path.startsWith(`${root}${sep}`);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

async function withInspectionSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeInspections < MAX_CONCURRENT_INSPECTIONS) activeInspections++;
  else {
    if (inspectionWaiters.length >= MAX_PENDING_INSPECTIONS) throw unavailable();
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const index = inspectionWaiters.indexOf(waiter);
          if (index >= 0) inspectionWaiters.splice(index, 1);
          reject(unavailable());
        }, MAX_METADATA_TIME_MS),
      };
      waiter.timer.unref();
      inspectionWaiters.push(waiter);
    });
  }
  try {
    return await operation();
  } finally {
    const waiter = inspectionWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    } else activeInspections--;
  }
}

function cloneUrl(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !value ||
    !/^[a-zA-Z0-9@.:/_~+-]+$/.test(value) ||
    value.split(/[/:]/).some((part) => part === '.' || part === '..')
  )
    throw unavailable();
  // A display-only address, never an argument to Git. Credentials and secrets
  // cannot be embedded in the operator-managed public API configuration.
  if (/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      !url.hostname ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === 'https:' && url.username)
    )
      throw unavailable();
    return value;
  } catch {
    throw unavailable();
  }
}

function configuration(): ExternalGitConfiguration | null {
  const raw = process.env.GIT_EXTERNAL_REPOSITORIES_JSON?.trim();
  const root = process.env.GIT_EXTERNAL_ROOT?.trim();
  if (!raw && !root) return null;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(raw || 'null') as JsonValue;
  } catch {
    throw unavailable();
  }
  if (!Array.isArray(parsed) || parsed.length > 1000) throw unavailable();
  if (!parsed.length && !root) return null;
  if (
    !root ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root === sep ||
    root === process.env.HOME ||
    hasControlCharacters(root)
  )
    throw unavailable();
  const managedRoot = process.env.GIT_TENANT_ROOT?.trim();
  if (managedRoot && (managedRoot === root || inside(root, managedRoot) || inside(managedRoot, root))) throw unavailable();
  const identities = new Set<string>();
  const paths = new Map<string, string>();
  const repositories = parsed.map((entry): ExternalGitRepositoryConfiguration => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw unavailable();
    const { tenantId, repositoryId, gitdir } = entry;
    if (
      typeof tenantId !== 'string' ||
      !UUID.test(tenantId) ||
      typeof repositoryId !== 'number' ||
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      typeof gitdir !== 'string' ||
      resolve(gitdir) !== gitdir ||
      !inside(root, gitdir) ||
      hasControlCharacters(gitdir)
    )
      throw unavailable();
    const identity = `${tenantId.toLowerCase()}:${repositoryId}`;
    if (
      identities.has(identity) ||
      Array.from(paths.entries()).some(
        ([path, owner]) => owner !== tenantId.toLowerCase() && (path === gitdir || inside(path, gitdir) || inside(gitdir, path)),
      )
    )
      throw unavailable();
    identities.add(identity);
    paths.set(gitdir, tenantId.toLowerCase());
    return { tenantId: tenantId.toLowerCase(), repositoryId, gitdir, cloneUrl: cloneUrl(entry.cloneUrl) };
  });
  return { root, repositories };
}

/** Exact server-side ownership mapping. A DB path alone grants no access. */
export function resolveExternalGitRepository(
  tenantId: string,
  repositoryId: number,
  gitdir: string,
): ExternalReadOnlyGitRepository | null {
  const config = configuration();
  const entry = config?.repositories.find(
    (candidate) =>
      candidate.tenantId === tenantId.toLowerCase() && candidate.repositoryId === repositoryId && candidate.gitdir === gitdir,
  );
  return config && entry ? new ExternalReadOnlyGitRepository(config.root, entry) : null;
}

/** Cleanup must protect every external path, even under a mismatching tenant. */
export function assertNoExternalGitCleanup(gitdir: string): void {
  const config = configuration();
  const target = resolve(gitdir);
  if (config && (target === config.root || inside(config.root, target))) {
    throw new ForbiddenException('Внешний репозиторий доступен только для чтения');
  }
}

async function assertCanonical(path: string, directory: boolean): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (await realpath(path)) !== path)
    throw unavailable();
}

/** Bind mount options, not file permissions, enforce that Git cannot write. */
async function assertReadOnlyMount(root: string): Promise<void> {
  if (process.platform !== 'linux') throw unavailable();
  const mounts = (await readFile('/proc/self/mountinfo', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const fields = line.split(' ');
      const path = fields[4]?.replace(/\\([0-7]{3})/g, (_match: string, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
      return { path, readOnly: fields[5]?.split(',').includes('ro') === true };
    });
  const mount = mounts
    .filter((entry) => entry.path && (entry.path === root || inside(entry.path, root) || entry.path === sep))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!mount?.readOnly) throw unavailable();
  // Nested mounts can alias another tenant's physical objects even if read-only.
  // Deployment uses one source-root bind, never per-repository nested binds.
  if (mounts.some((entry) => entry.path && inside(root, entry.path))) throw unavailable();
}

async function readRegular(path: string, limit: number): Promise<Buffer> {
  await assertCanonical(path, false);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit || stat.nlink !== 1) throw unavailable();
    const contents = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < contents.length) {
      const result = await file.read(contents, bytes, contents.length - bytes, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > stat.size) throw unavailable();
    return contents.subarray(0, bytes);
  } finally {
    await file.close();
  }
}

async function exists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
}

function validRefName(value: string): boolean {
  return (
    value.startsWith('refs/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !hasControlCharacters(value) &&
    !value.includes('[') &&
    !/[\s~^:?*\\]/.test(value) &&
    value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

function validateRefContents(contents: Buffer, head = false): void {
  const value = contents.toString('utf8');
  const target = value.trim();
  if (/^[a-f0-9]{40}$/.test(target)) return;
  if ((head || target.startsWith('ref: ')) && target.startsWith('ref: ') && validRefName(target.slice(5))) return;
  throw unavailable();
}

function assertReadCommand(args: string[]): void {
  const safeValue = (value: string | undefined) => Boolean(value && !value.startsWith('-') && !hasControlCharacters(value));
  const command = args[0];
  const valid =
    (command === 'for-each-ref' &&
      args.length === 4 &&
      args[1] === '--sort=-committerdate' &&
      args[2] === '--format=%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso8601-strict)' &&
      args[3] === 'refs/heads') ||
    (command === 'log' &&
      args.length === 7 &&
      /^--skip=\d+$/.test(args[1]) &&
      /^--max-count=\d+$/.test(args[2]) &&
      args[3] === '-z' &&
      args[4] === '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s' &&
      safeValue(args[5]) &&
      args[6] === '--') ||
    (command === 'ls-tree' &&
      [5, 6].includes(args.length) &&
      args[1] === '-z' &&
      args[2] === '--long' &&
      safeValue(args[3]) &&
      args[4] === '--' &&
      (args.length === 5 || safeValue(args[5]))) ||
    (command === 'cat-file' && args.length === 3 && ['-t', '-s', 'blob'].includes(args[1]) && safeValue(args[2])) ||
    (command === 'rev-parse' && args.length === 4 && args[1] === '--verify' && args[2] === '--quiet' && safeValue(args[3])) ||
    (command === 'diff' &&
      [7, 8].includes(args.length) &&
      args[1] === '--no-color' &&
      args[2] === '--no-ext-diff' &&
      args[3] === '--no-textconv' &&
      args[4] === '-M' &&
      safeValue(args[5]) &&
      args[args.length - 1] === '--' &&
      (args.length === 7 || safeValue(args[6])));
  if (!valid) throw new ForbiddenException('Операция недоступна для внешнего репозитория');
}

/**
 * A read-only adapter over operator-owned repositories. Git never opens their
 * configuration, hooks, worktree or index. Only validated refs and objects are
 * exposed through an ephemeral bare metadata view outside the mounted source.
 */
export class ExternalReadOnlyGitRepository {
  readonly cloneUrl: string | null;

  constructor(
    private readonly root: string,
    private readonly entry: ExternalGitRepositoryConfiguration,
  ) {
    this.cloneUrl = entry.cloneUrl;
  }

  private async metadata(): Promise<RepositorySnapshot> {
    return withInspectionSlot(() => this.inspectMetadata());
  }

  private async inspectMetadata(): Promise<RepositorySnapshot> {
    const deadline = Date.now() + MAX_METADATA_TIME_MS;
    const assertDeadline = () => {
      if (Date.now() > deadline) throw unavailable();
    };
    // Recheck configuration on every use, including a previously resolved adapter.
    const current = configuration();
    if (
      !current ||
      current.root !== this.root ||
      !current.repositories.some(
        (candidate) =>
          candidate.tenantId === this.entry.tenantId &&
          candidate.repositoryId === this.entry.repositoryId &&
          candidate.gitdir === this.entry.gitdir,
      )
    )
      throw unavailable();
    await assertCanonical(this.root, true);
    await assertReadOnlyMount(this.root);
    await assertCanonical(this.entry.gitdir, true);
    const dotGit = join(this.entry.gitdir, '.git');
    const source = (await exists(dotGit)) ? dotGit : this.entry.gitdir;
    await assertCanonical(source, true);
    for (const unsupported of [
      'commondir',
      'gitdir',
      'config.worktree',
      'shallow',
      'objects/info/alternates',
      'objects/info/http-alternates',
    ]) {
      if (await exists(join(source, unsupported))) throw unavailable();
    }
    const config = (await readRegular(join(source, 'config'), 128 * 1024)).toString('utf8');
    // The source config is never passed to Git, but reject layouts whose object
    // semantics cannot be represented by the deliberately small safe view.
    if (
      /^\s*\[\s*(include|includeif|extensions)(?:\s|\])/im.test(config) ||
      /^\s*repositoryformatversion\s*=\s*[^0\s]/im.test(config)
    )
      throw unavailable();
    await assertCanonical(join(source, 'objects'), true);
    await assertCanonical(join(source, 'refs'), true);
    let visited = 0;
    const inspectObjects = async (directory: string, depth = 0): Promise<void> => {
      assertDeadline();
      if (depth > 32) throw unavailable();
      for await (const entry of await opendir(directory)) {
        assertDeadline();
        if (++visited > MAX_ENTRIES) throw unavailable();
        const path = join(directory, entry.name);
        const stat = await lstat(path);
        // `git clone --local` legitimately hardlinks immutable object files.
        // A hardlink is an entry inside this explicitly mapped, operator-owned
        // read-only store, not a path traversal. Metadata still requires nlink=1.
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw unavailable();
        if (stat.isDirectory()) {
          await assertCanonical(path, true);
          await inspectObjects(path, depth + 1);
        }
        if (entry.name.endsWith('.promisor')) throw unavailable();
      }
    };
    await inspectObjects(join(source, 'objects'));
    const metadata: MetadataFile[] = [];
    let totalBytes = 0;
    const append = (path: string, contents: Buffer) => {
      totalBytes += contents.length + Buffer.byteLength(path) + 128;
      if (totalBytes > MAX_METADATA_BYTES || metadata.length >= MAX_METADATA_FILES || path.length > 1024) throw unavailable();
      metadata.push({ path, contents });
    };
    const head = await readRegular(join(source, 'HEAD'), 1024);
    validateRefContents(head, true);
    append('HEAD', head);
    const inspectRefs = async (directory: string, relative: string, depth = 0): Promise<void> => {
      assertDeadline();
      if (depth > 32) throw unavailable();
      for await (const entry of await opendir(directory)) {
        assertDeadline();
        if (++visited > MAX_ENTRIES) throw unavailable();
        const path = join(directory, entry.name);
        const ref = `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          await assertCanonical(path, true);
          await inspectRefs(path, ref, depth + 1);
        } else {
          if (!validRefName(ref)) throw unavailable();
          const contents = await readRegular(path, 1024);
          validateRefContents(contents);
          append(ref, contents);
        }
      }
    };
    await inspectRefs(join(source, 'refs'), 'refs');
    if (await exists(join(source, 'packed-refs'))) {
      assertDeadline();
      const packed = await readRegular(join(source, 'packed-refs'), MAX_METADATA_BYTES);
      let start = 0;
      let lines = 0;
      while (start < packed.length) {
        assertDeadline();
        if (++lines > MAX_METADATA_FILES) throw unavailable();
        const newline = packed.indexOf(10, start);
        const end = newline < 0 ? packed.length : newline;
        if (end - start > 2048) throw unavailable();
        const line = packed.subarray(start, end).toString('utf8');
        start = end + 1;
        if (!line || line.startsWith('#') || /^\^[a-f0-9]{40}$/.test(line)) continue;
        if (!/^[a-f0-9]{40} /.test(line) || !validRefName(line.slice(41))) throw unavailable();
      }
      append('packed-refs', packed);
    }
    assertDeadline();
    return { objects: join(source, 'objects'), files: metadata };
  }

  async available(): Promise<boolean> {
    try {
      await this.metadata();
      return true;
    } catch {
      return false;
    }
  }

  async execute(args: string[]): Promise<Buffer> {
    assertReadCommand(args);
    return withInspectionSlot(() => this.executeRead(args));
  }

  private async executeRead(args: string[]): Promise<Buffer> {
    let metadata: RepositorySnapshot;
    try {
      metadata = await this.inspectMetadata();
    } catch {
      throw unavailable();
    }
    const preparationDeadline = Date.now() + MAX_METADATA_TIME_MS;
    const view = await mkdtemp(join(tmpdir(), 'nervion-git-view-'));
    try {
      await mkdir(join(view, 'refs'), { mode: 0o700 });
      await mkdir(join(view, 'objects'), { mode: 0o700 });
      await writeFile(join(view, 'config'), SAFE_CONFIG, { mode: 0o600, flag: 'wx' });
      for (const file of metadata.files) {
        if (Date.now() > preparationDeadline) throw unavailable();
        const target = join(view, file.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, file.contents, { mode: 0o600, flag: 'wx' });
      }
      if (Date.now() > preparationDeadline) throw unavailable();
      const env = gitEnvironment(
        [
          ['protocol.never.allow', 'never'],
          ['core.bare', 'true'],
          ['core.logAllRefUpdates', 'false'],
          ['core.commitGraph', 'false'],
          ['core.multiPackIndex', 'false'],
          ['diff.external', ''],
          ['diff.trustExitCode', 'false'],
        ],
        'never',
      );
      env.GIT_ALLOW_PROTOCOL = '';
      env.GIT_OBJECT_DIRECTORY = metadata.objects;
      return await executeGit(['--git-dir', view, ...args], env);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw unavailable();
    } finally {
      await rm(view, { recursive: true, force: true });
    }
  }
}
