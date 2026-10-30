import type { EntityManager, Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { GitRepositoryAvailability, GitRepositoryMode, TenantStatus } from '@tracker/contracts';
import { GitService } from './git.service';
import type { Repo } from './entities/repo.entity';
import type { Projects } from '../projects/entities/project.entity';
import type { TenantJobsService } from '../tenancy/tenant-jobs.service';
import { tenantStorage, type TenantExecutionContext } from '../tenancy/tenant-context.service';
import { createTenantGitCopy, readGitConnection, removeTenantGitCopy } from './git-tenant-storage';
import { ExternalReadOnlyGitRepository } from './git-external-readonly';

jest.mock('./git-tenant-storage', () => ({
  ...jest.requireActual<typeof import('./git-tenant-storage')>('./git-tenant-storage'),
  createTenantGitCopy: jest.fn(),
  readGitConnection: jest.fn(),
  removeTenantGitCopy: jest.fn(),
}));

describe('Git service tenant policy', () => {
  const originalEnv = { ...process.env };
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const oldGitdir =
    '/srv/tenant-git/tenants/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/repository.git';
  const query = jest.fn().mockResolvedValue([{ acquired: true }]);
  const findOne = jest.fn();
  const count = jest.fn().mockResolvedValue(0);
  const remove = jest.fn();
  const save = jest.fn();
  const enqueue = jest.fn();
  const repos = { findOne, count, remove, save } as object as Repository<Repo>;
  const projects = {} as Repository<Projects>;
  const jobs = { register: jest.fn(), enqueue } as object as TenantJobsService;
  let service: GitService;
  let context: TenantExecutionContext;

  beforeEach(() => {
    process.env.TENANCY_ENABLED = 'true';
    process.env.GIT_TENANT_ROOT = '/srv/tenant-git';
    delete process.env.GIT_EXTERNAL_ROOT;
    delete process.env.GIT_EXTERNAL_REPOSITORIES_JSON;
    service = new GitService(repos, projects, jobs);
    context = {
      tenant: {
        id: tenantId,
        readOnly: false,
        featureFlags: { git: true },
        slug: 'test',
        hostname: 'test.example.test',
        status: TenantStatus.ACTIVE,
        databaseShardId: 'data_1',
        storageNamespace: `tenants/${tenantId}`,
      },
      manager: { query } as object as EntityManager,
      active: true,
      actorId: 7,
      afterCommit: [],
      afterRollback: [],
      pending: new Set(),
    };
    query.mockResolvedValue([{ acquired: true }]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('rejects calls without TenantContext before touching a repository', async () => {
    await expect(service.branches(1, 7)).rejects.toThrow();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('requires an explicit feature flag even for repository reads', async () => {
    context.tenant.featureFlags.git = false;
    await tenantStorage.run(context, async () => {
      await expect(service.listRepos(7)).rejects.toThrow('Git отключен');
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it.each(['create', 'fetch', 'delete'])('blocks %s before filesystem work in read-only mode', async (operation) => {
    context.tenant.readOnly = true;
    await tenantStorage.run(context, async () => {
      const request =
        operation === 'create'
          ? service.createRepo({ name: 'repo', remoteUrl: 'https://github.com/team/repo.git' }, 7)
          : operation === 'fetch'
            ? service.fetchRepo(1, 7)
            : service.deleteRepo(1, 7);
      await expect(request).rejects.toThrow('только для чтения');
    });
    expect(query).not.toHaveBeenCalled();
    expect(createTenantGitCopy).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied filesystem path in SaaS', async () => {
    await tenantStorage.run(context, async () => {
      await expect(service.createRepo({ name: 'repo', gitdir: '/another/customer/repo.git' }, 7)).rejects.toThrow('HTTPS');
    });
    expect(createTenantGitCopy).not.toHaveBeenCalled();
  });

  it('rejects a global/other-tenant path even if an inconsistent DB row is returned', async () => {
    findOne.mockResolvedValue({ id: 1, projectId: null, gitdir: '/global/repo.git' });
    await tenantStorage.run(context, async () => {
      await expect(service.branches(1, 7)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('uses a tenant-specific advisory lock to avoid overlapping external mutations', async () => {
    query.mockResolvedValue([{ acquired: false }]);
    await tenantStorage.run(context, async () => {
      await expect(service.deleteRepo(1, 7)).rejects.toThrow('уже выполняется');
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_xact_lock'), [`${tenantId}:git`]);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('never exposes stored credentials in the repository list', async () => {
    const repo = { id: 1, projectId: null, name: 'repo', gitdir: oldGitdir, defaultBranch: 'main' };
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([repo]),
    };
    const listService = new GitService({ createQueryBuilder: () => builder } as object as Repository<Repo>, projects, jobs);
    jest
      .mocked(readGitConnection)
      .mockResolvedValue({ remoteUrl: 'https://github.com/team/repo.git', username: 'reader', token: 'private-pat' });
    const result = await tenantStorage.run(context, () => listService.listRepos(7));
    expect(result[0]).toEqual({
      id: 1,
      projectId: null,
      name: 'repo',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/team/repo.git',
      mode: GitRepositoryMode.MANAGED,
      availability: GitRepositoryAvailability.AVAILABLE,
      capabilities: { canRead: true, canFetch: true, canDelete: true },
    });
    expect(JSON.stringify(result)).not.toContain('private-pat');
    expect(JSON.stringify(result)).not.toContain(oldGitdir);
  });

  it('cleanup jobs cannot remove a path still referenced by a repository', async () => {
    const handlers = new Map<string, (job: { tenant_id: string; payload: { gitdir: string } }) => Promise<void>>();
    const cleanupService = new GitService(
      { existsBy: jest.fn().mockResolvedValue(true) } as object as Repository<Repo>,
      projects,
      {
        register: (kind: string, handler: (job: { tenant_id: string; payload: { gitdir: string } }) => Promise<void>) =>
          handlers.set(kind, handler),
      } as object as TenantJobsService,
    );
    cleanupService.onModuleInit();
    await tenantStorage.run(context, () => handlers.get('git.cleanup')!({ tenant_id: tenantId, payload: { gitdir: oldGitdir } }));
    expect(removeTenantGitCopy).not.toHaveBeenCalled();
  });

  function externalConfiguration(gitdir = '/srv/external-git/repository.git') {
    process.env.GIT_EXTERNAL_ROOT = '/srv/external-git';
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = JSON.stringify([{ tenantId, repositoryId: 1, gitdir }]);
    return gitdir;
  }

  function serviceWithList(rows: Array<{ id: number; projectId: null; name: string; gitdir: string; defaultBranch: string }>) {
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    return new GitService({ createQueryBuilder: () => builder } as object as Repository<Repo>, projects, jobs);
  }

  it.each(['fetch', 'delete'])('rejects external %s before deleting DB metadata or touching storage', async (operation) => {
    const gitdir = externalConfiguration();
    findOne.mockResolvedValue({ id: 1, projectId: null, gitdir });
    await tenantStorage.run(context, async () => {
      await expect(operation === 'fetch' ? service.fetchRepo(1, 7) : service.deleteRepo(1, 7)).rejects.toThrow(
        'только для чтения',
      );
    });
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(createTenantGitCopy).not.toHaveBeenCalled();
    expect(removeTenantGitCopy).not.toHaveBeenCalled();
  });

  it('rejects cleanup for an external path even in another tenant and without a DB reference', async () => {
    const gitdir = externalConfiguration();
    context.tenant.id = '22222222-2222-4222-8222-222222222222';
    const handlers = new Map<string, (job: { tenant_id: string; payload: { gitdir: string } }) => Promise<void>>();
    const cleanupService = new GitService(
      { existsBy: jest.fn().mockResolvedValue(false) } as object as Repository<Repo>,
      projects,
      {
        register: (kind: string, handler: (job: { tenant_id: string; payload: { gitdir: string } }) => Promise<void>) =>
          handlers.set(kind, handler),
      } as object as TenantJobsService,
    );
    cleanupService.onModuleInit();
    await tenantStorage.run(context, async () => {
      await expect(handlers.get('git.cleanup')!({ tenant_id: context.tenant.id, payload: { gitdir } })).rejects.toThrow(
        'только для чтения',
      );
    });
    expect(removeTenantGitCopy).not.toHaveBeenCalled();
  });

  it('returns unavailable external metadata without breaking the repository list', async () => {
    const gitdir = externalConfiguration();
    const listService = serviceWithList([
      { id: 1, projectId: null, name: 'missing', gitdir, defaultBranch: 'main' },
      { id: 2, projectId: null, name: 'managed', gitdir: oldGitdir, defaultBranch: 'main' },
    ]);
    jest.mocked(readGitConnection).mockResolvedValue({ remoteUrl: 'https://github.com/team/repo.git', username: '', token: '' });
    const rows = await tenantStorage.run(context, () => listService.listRepos(7));
    expect(rows[0]).toMatchObject({
      id: 1,
      mode: GitRepositoryMode.EXTERNAL_READ_ONLY,
      availability: GitRepositoryAvailability.UNAVAILABLE,
      cloneUrl: null,
      capabilities: { canRead: false, canFetch: false, canDelete: false },
    });
    expect(rows[1].availability).toBe(GitRepositoryAvailability.AVAILABLE);
    expect(JSON.stringify(rows)).not.toContain(gitdir);
    expect(readGitConnection).toHaveBeenCalledTimes(1);
  });

  it('advertises no mutation capabilities in read-only tenants or unavailable managed repositories', async () => {
    const listService = serviceWithList([{ id: 2, projectId: null, name: 'managed', gitdir: oldGitdir, defaultBranch: 'main' }]);
    context.tenant.readOnly = true;
    jest.mocked(readGitConnection).mockResolvedValue({ remoteUrl: 'https://github.com/team/repo.git', username: '', token: '' });
    const readOnly = await tenantStorage.run(context, () => listService.listRepos(7));
    expect(readOnly[0].capabilities).toEqual({ canRead: true, canFetch: false, canDelete: false });
    context.tenant.readOnly = false;
    jest.mocked(readGitConnection).mockRejectedValue(new Error('Storage unavailable'));
    const missing = await tenantStorage.run(context, () => listService.listRepos(7));
    expect(missing[0].capabilities).toEqual({ canRead: false, canFetch: false, canDelete: false });
    expect(missing[0].availability).toBe(GitRepositoryAvailability.UNAVAILABLE);
  });

  it('selects an available repository by default but preserves an explicitly selected unavailable entry', async () => {
    const gitdir = externalConfiguration();
    const listService = serviceWithList([
      { id: 1, projectId: null, name: 'missing', gitdir, defaultBranch: 'main' },
      { id: 2, projectId: null, name: 'managed', gitdir: oldGitdir, defaultBranch: 'main' },
    ]);
    jest.mocked(readGitConnection).mockResolvedValue({ remoteUrl: null, username: '', token: '' });
    const readBranches = jest.spyOn(listService, 'branches').mockResolvedValue([]);
    const defaultSelection = await tenantStorage.run(context, () => listService.getInitial(7));
    expect(defaultSelection.repoId).toBe(2);
    expect(readBranches).toHaveBeenCalledWith(2, 7);
    readBranches.mockClear();
    const explicitSelection = await tenantStorage.run(context, () => listService.getInitial(7, undefined, 1));
    expect(explicitSelection).toMatchObject({ repoId: 1, branch: '', branches: [], commits: [], tree: [], detail: null });
    expect(readBranches).not.toHaveBeenCalled();
  });

  it('routes external reads through the isolated adapter and never the managed connection', async () => {
    const gitdir = externalConfiguration();
    findOne.mockResolvedValue({ id: 1, projectId: null, gitdir, defaultBranch: 'main' });
    const execute = jest
      .spyOn(ExternalReadOnlyGitRepository.prototype, 'execute')
      .mockResolvedValue(Buffer.from('main\x1fabc123\x1f2026-10-30T10:00:00+00:00\n'));
    const rows = await tenantStorage.run(context, () => service.branches(1, 7));
    expect(rows[0]).toMatchObject({ name: 'main', isDefault: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(readGitConnection).not.toHaveBeenCalled();
  });
});
