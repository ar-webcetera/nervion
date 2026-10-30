import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoExternalGitCleanup, resolveExternalGitRepository } from './git-external-readonly';
import { executeGit, gitEnvironment } from './git-runtime';

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises'),
  readFile: jest.fn(),
}));
jest.mock('./git-runtime', () => ({
  ...jest.requireActual<typeof import('./git-runtime')>('./git-runtime'),
  executeGit: jest.fn(),
}));

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const actualFs = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
const actualGit = jest.requireActual<typeof import('./git-runtime')>('./git-runtime');
const branches = [
  'for-each-ref',
  '--sort=-committerdate',
  '--format=%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso8601-strict)',
  'refs/heads',
];

describe('external read-only Git adapter', () => {
  const originalEnv = { ...process.env };
  let root: string;
  let source: string;
  let mountReadOnly: boolean;
  let nestedWritable: boolean;
  let nestedReadOnly: boolean;

  const git = (args: string[], input?: string, protocol = 'never') =>
    execFileSync('git', args, {
      env: gitEnvironment(
        [
          ['user.email', 'fixture@example.test'],
          ['user.name', 'Fixture'],
        ],
        protocol,
      ),
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

  function seed(directory: string, content: string) {
    const blob = git(['--git-dir', directory, 'hash-object', '-w', '--stdin'], content).trim();
    const tree = git(['--git-dir', directory, 'mktree'], `100644 blob ${blob}\tREADME.txt\n`).trim();
    const commit = git(['--git-dir', directory, 'commit-tree', tree], 'Fixture commit\n').trim();
    git(['--git-dir', directory, 'update-ref', 'refs/heads/main', commit]);
    return { blob, tree, commit };
  }

  interface FileSnapshot {
    path: string;
    digest: string;
    mode: number;
    ino: number;
    nlink: number;
    mtimeMs: number;
  }

  async function snapshot(directory: string, prefix = ''): Promise<FileSnapshot[]> {
    const result: FileSnapshot[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(path);
      if (stat.isDirectory()) result.push(...(await snapshot(path, relative)));
      else
        result.push({
          path: relative,
          digest: createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
          mode: stat.mode,
          ino: stat.ino,
          nlink: stat.nlink,
          mtimeMs: stat.mtimeMs,
        });
    }
    return result;
  }

  function mapping(repositoryId = 1, gitdir = source, tenantId = tenantA, cloneUrl?: string): void {
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = JSON.stringify([{ tenantId, repositoryId, gitdir, cloneUrl }]);
  }

  function adapter() {
    const value = resolveExternalGitRepository(tenantA, 1, source);
    if (!value) throw new Error('Missing configured adapter');
    return value;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nervion-external-git-test-'));
    source = join(root, 'source.git');
    git(['init', '--bare', '--template=', '--initial-branch=main', source]);
    process.env.GIT_EXTERNAL_ROOT = root;
    process.env.GIT_TENANT_ROOT = `${root}-managed`;
    mapping();
    mountReadOnly = true;
    nestedWritable = false;
    nestedReadOnly = false;
    jest.mocked(readFile).mockImplementation(async (path, options) => {
      if (path === '/proc/self/mountinfo') {
        return (
          `1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 8:1 /external ${root} ${mountReadOnly ? 'ro' : 'rw'} - ext4 /dev/root rw\n` +
          (nestedWritable || nestedReadOnly
            ? `3 2 8:1 /other ${source}/objects ${nestedWritable ? 'rw' : 'ro'} - ext4 /dev/root rw\n`
            : '')
        );
      }
      return actualFs.readFile(path, options);
    });
    jest.mocked(executeGit).mockImplementation(actualGit.executeGit);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('is disabled with an empty default mapping and no root', () => {
    delete process.env.GIT_EXTERNAL_ROOT;
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = '[]';
    expect(resolveExternalGitRepository(tenantA, 1, source)).toBeNull();
  });

  it('requires an exact tenant, repository ID and stored path match', () => {
    expect(resolveExternalGitRepository(tenantB, 1, source)).toBeNull();
    expect(resolveExternalGitRepository(tenantA, 2, source)).toBeNull();
    expect(resolveExternalGitRepository(tenantA, 1, `${source}/other`)).toBeNull();
    expect(resolveExternalGitRepository(tenantA, 1, source)).not.toBeNull();
  });

  it('allows same-tenant aliases but rejects cross-tenant ownership of the same or nested path', () => {
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = JSON.stringify([
      { tenantId: tenantA, repositoryId: 1, gitdir: source },
      { tenantId: tenantA, repositoryId: 2, gitdir: source },
    ]);
    expect(resolveExternalGitRepository(tenantA, 2, source)).not.toBeNull();
    for (const path of [source, join(source, 'nested')]) {
      process.env.GIT_EXTERNAL_REPOSITORIES_JSON = JSON.stringify([
        { tenantId: tenantA, repositoryId: 1, gitdir: source },
        { tenantId: tenantB, repositoryId: 2, gitdir: path },
      ]);
      expect(() => resolveExternalGitRepository(tenantA, 1, source)).toThrow();
    }
  });

  it('rejects roots overlapping managed storage', () => {
    process.env.GIT_TENANT_ROOT = root;
    expect(() => resolveExternalGitRepository(tenantA, 1, source)).toThrow();
  });

  it('requires a read-only mount and rejects writable nested mounts', async () => {
    expect(await adapter().available()).toBe(true);
    mountReadOnly = false;
    expect(await adapter().available()).toBe(false);
    mountReadOnly = true;
    nestedWritable = true;
    expect(await adapter().available()).toBe(false);
    nestedWritable = false;
    nestedReadOnly = true;
    expect(await adapter().available()).toBe(false);
    expect(executeGit).not.toHaveBeenCalled();
  });

  it('protects all external-root paths from cleanup regardless of mapping or tenant', () => {
    expect(() => assertNoExternalGitCleanup(source)).toThrow();
    expect(() => assertNoExternalGitCleanup(join(root, 'not-mapped.git'))).toThrow();
    expect(() => assertNoExternalGitCleanup(`${root}/unrelated/../source.git`)).toThrow();
    expect(() => assertNoExternalGitCleanup(`${root}-managed/repository.git`)).not.toThrow();
  });

  it.each([
    'git@code.example.test:team/repo.git',
    'ssh://git@code.example.test/team/repo.git',
    'https://code.example.test/team/repo.git',
  ])('publishes only an explicit safe clone address: %s', (cloneUrl) => {
    mapping(1, source, tenantA, cloneUrl);
    expect(adapter().cloneUrl).toBe(cloneUrl);
  });

  it.each([
    'https://token@code.example.test/repo.git',
    'ssh://git:secret@code.example.test/repo.git',
    'https://code.example.test/$(id)',
    'https://code.example.test/repo;id',
    'https://code.example.test/a/../repo',
    'git@code.example.test:../repo.git',
    'https://code.example.test/repo%20name',
    'https://code.example.test/repo?token=secret',
  ])('rejects credentials, shell syntax and ambiguous clone URLs: %s', (cloneUrl) => {
    mapping(1, source, tenantA, cloneUrl);
    expect(() => adapter()).toThrow();
  });

  it('preserves missing repository metadata without running Git', async () => {
    source = join(root, 'missing.git');
    mapping();
    expect(await adapter().available()).toBe(false);
    await expect(adapter().execute(branches)).rejects.toThrow('недоступен');
    expect(executeGit).not.toHaveBeenCalled();
  });

  it.each(['commondir', 'gitdir', 'config.worktree', 'shallow', 'objects/info/alternates', 'objects/info/http-alternates'])(
    'rejects a layout that can read data outside the mapped repository: %s',
    async (path) => {
      await writeFile(join(source, path), '/another/tenant/repository');
      expect(await adapter().available()).toBe(false);
      expect(executeGit).not.toHaveBeenCalled();
    },
  );

  it('rejects source config includes and unsupported object formats', async () => {
    for (const config of [
      '[include]\npath=/etc/gitconfig\n',
      '[includeIf "gitdir:*"]\npath=/elsewhere\n',
      '[extensions]\nobjectformat=sha256\n',
    ]) {
      await writeFile(join(source, 'config'), config);
      expect(await adapter().available()).toBe(false);
    }
  });

  it('rejects symlinks in the repository, refs and object store', async () => {
    const link = join(root, 'linked.git');
    await symlink(source, link);
    mapping(1, link);
    expect(await resolveExternalGitRepository(tenantA, 1, link)?.available()).toBe(false);
    mapping();
    await symlink('/etc/passwd', join(source, 'objects', 'unsafe'));
    expect(await adapter().available()).toBe(false);
    await rm(join(source, 'objects', 'unsafe'));
    await symlink('/etc/passwd', join(source, 'refs', 'heads', 'unsafe'));
    expect(await adapter().available()).toBe(false);
  });

  it('rejects partial clones rather than enabling lazy network fetches', async () => {
    await writeFile(join(source, 'objects', 'pack', 'pack-test.promisor'), '');
    expect(await adapter().available()).toBe(false);
  });

  it.each([false, true])(
    'reads a standard local clone with immutable object hardlinks (packed=%s) without modifying either repository',
    async (packed) => {
      const original = source;
      const data = seed(original, 'Shared immutable fixture\n');
      if (packed) git(['--git-dir', original, 'repack', '-ad']);
      source = join(root, 'clone.git');
      git(['clone', '--local', '--bare', '--template=', '--', original, source], undefined, 'file');
      mapping();
      const before = await snapshot(root);
      const linked = before.filter((file) => file.path.startsWith('clone.git/objects/') && file.nlink > 1);
      expect(linked.length).toBeGreaterThan(0);
      expect(linked.some((file) => file.path.endsWith('.pack'))).toBe(packed);
      expect(await adapter().available()).toBe(true);
      expect((await adapter().execute(branches)).toString()).toContain('main');
      expect(
        (
          await adapter().execute([
            'log',
            '--skip=0',
            '--max-count=5',
            '-z',
            '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s',
            'main',
            '--',
          ])
        ).toString(),
      ).toContain(data.commit);
      expect((await adapter().execute(['ls-tree', '-z', '--long', 'main', '--'])).toString()).toContain('README.txt');
      expect((await adapter().execute(['cat-file', 'blob', 'main:README.txt'])).toString()).toBe('Shared immutable fixture\n');
      expect(resolveExternalGitRepository(tenantB, 1, source)).toBeNull();
      await expect(adapter().execute(['fetch', 'origin'])).rejects.toThrow();
      expect(await snapshot(root)).toEqual(before);
    },
  );

  it.each(['config', 'HEAD', 'refs/heads/main', 'packed-refs'])(
    'still rejects hardlinked repository metadata: %s',
    async (name) => {
      seed(source, 'Metadata fixture\n');
      if (name === 'packed-refs') git(['--git-dir', source, 'pack-refs', '--all']);
      await link(join(source, name), join(root, 'metadata-link'));
      expect(await adapter().available()).toBe(false);
      await expect(adapter().execute(branches)).rejects.toThrow('недоступен');
      expect(executeGit).not.toHaveBeenCalled();
    },
  );

  it('cannot read an arbitrary object hash that exists only in an unmapped repository', async () => {
    seed(source, 'Visible content\n');
    const foreign = join(root, 'unmapped.git');
    git(['init', '--bare', '--template=', '--initial-branch=main', foreign]);
    const hidden = seed(foreign, 'Unmapped content\n');
    expect(await adapter().available()).toBe(true);
    expect(resolveExternalGitRepository(tenantA, 2, foreign)).toBeNull();
    expect(resolveExternalGitRepository(tenantB, 1, source)).toBeNull();
    await expect(adapter().execute(['cat-file', 'blob', hidden.blob])).rejects.toThrow();
    expect((await adapter().execute(['cat-file', 'blob', 'main:README.txt'])).toString()).toBe('Visible content\n');
  });

  it.each([
    ['fetch', 'origin'],
    ['config', 'core.hooksPath'],
    ['update-ref', 'refs/heads/main', 'a'.repeat(40)],
    ['log', '--ext-diff'],
    ['cat-file', '--filters', 'main:file'],
  ])('rejects non-read or broadened commands before filesystem/process work: %j', async (...args) => {
    await expect(adapter().execute(args)).rejects.toThrow('Операция недоступна');
    expect(executeGit).not.toHaveBeenCalled();
  });

  it('reads current working-repository commits through isolated metadata without source hooks, config or writes', async () => {
    source = join(root, 'working');
    git(['init', '--template=', '--initial-branch=main', source]);
    await writeFile(join(source, 'hello.txt'), 'first\n');
    git(['-C', source, 'add', 'hello.txt']);
    git(['-C', source, 'commit', '-m', 'first']);
    const metadata = join(source, '.git');
    const originalConfig = await readFile(join(metadata, 'config'), 'utf8');
    await writeFile(
      join(metadata, 'config'),
      `${originalConfig}\n[core]\nfsmonitor = /bad-command\nhooksPath = /bad-hooks\n[diff]\nexternal = /bad-diff\n[credential]\nhelper = /bad-credential\n[remote "origin"]\nurl = https://secret:token@invalid.test/repo\n`,
    );
    await mkdir(join(metadata, 'hooks'), { recursive: true });
    await writeFile(join(metadata, 'hooks', 'post-receive'), '#!/bin/sh\nexit 99\n');
    mapping();
    const initialConfig = await readFile(join(metadata, 'config'), 'utf8');
    const initialHook = await readFile(join(metadata, 'hooks', 'post-receive'), 'utf8');
    const first = await adapter().execute(branches);
    expect(first.toString()).toContain('main');
    expect((await adapter().execute(['cat-file', 'blob', 'main:hello.txt'])).toString()).toBe('first\n');
    git(['-C', source, 'config', 'core.fsmonitor', 'false']);
    await writeFile(join(source, 'hello.txt'), 'second\n');
    git(['-C', source, 'add', 'hello.txt']);
    git(['-C', source, 'commit', '-m', 'second']);
    await writeFile(join(metadata, 'config'), initialConfig);
    expect((await adapter().execute(['cat-file', 'blob', 'main:hello.txt'])).toString()).toBe('second\n');
    expect(
      (
        await adapter().execute([
          'log',
          '--skip=0',
          '--max-count=30',
          '-z',
          '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s',
          'main',
          '--',
        ])
      ).toString(),
    ).toContain('second');
    expect((await adapter().execute(['ls-tree', '-z', '--long', 'main', '--'])).toString()).toContain('hello.txt');
    expect((await adapter().execute(['rev-parse', '--verify', '--quiet', 'main^'])).toString().trim()).toMatch(/^[a-f0-9]{40}$/);
    expect(
      (await adapter().execute(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', 'main^', 'main', '--'])).toString(),
    ).toContain('+second');
    expect(await readFile(join(metadata, 'config'), 'utf8')).toBe(initialConfig);
    expect(await readFile(join(metadata, 'hooks', 'post-receive'), 'utf8')).toBe(initialHook);
    for (const [args, env] of jest.mocked(executeGit).mock.calls) {
      expect(args[1]).not.toBe(metadata);
      expect(env?.GIT_OBJECT_DIRECTORY).toBe(join(metadata, 'objects'));
      expect(env?.GIT_ALLOW_PROTOCOL).toBe('');
      expect(env?.GIT_NO_LAZY_FETCH).toBe('1');
      expect(env?.GIT_NO_REPLACE_OBJECTS).toBe('1');
      expect(JSON.stringify(env)).not.toContain('secret:token');
      await expect(actualFs.lstat(args[1])).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readdir(metadata)).not.toContain('index.lock');
  });

  it('bounds concurrent inspection and Git operations across independent requests', async () => {
    let active = 0;
    let maximum = 0;
    jest.mocked(executeGit).mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      active--;
      return Buffer.alloc(0);
    });
    await Promise.all(Array.from({ length: 12 }, () => adapter().execute(branches)));
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(executeGit).toHaveBeenCalledTimes(12);
  });

  it('rechecks revoked mappings before using a previously resolved adapter', async () => {
    const selected = adapter();
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = '[]';
    expect(await selected.available()).toBe(false);
    await expect(selected.execute(branches)).rejects.toThrow();
    expect(executeGit).not.toHaveBeenCalled();
  });
});
