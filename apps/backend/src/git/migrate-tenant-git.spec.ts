import { DataSource } from 'typeorm';
import { migrateTenantGit } from './migrate-tenant-git';
import { createTenantGitCopy, removeTenantGitCopy } from './git-tenant-storage';

jest.mock('./git-tenant-storage', () => ({
  ...jest.requireActual('./git-tenant-storage'),
  createTenantGitCopy: jest.fn(),
}));

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const externalRoot = '/srv/example-external-git';
const source = `${externalRoot}/existing.git`;

describe('external repository migration boundary', () => {
  const originalEnv = { ...process.env };
  let database: DataSource;
  let output: jest.SpyInstance;

  beforeEach(() => {
    process.env.GIT_TENANT_ROOT = '/srv/example-managed-git';
    process.env.GIT_MIGRATION_SOURCE_ROOTS = externalRoot;
    process.env.GIT_EXTERNAL_ROOT = externalRoot;
    process.env.GIT_EXTERNAL_REPOSITORIES_JSON = JSON.stringify([
      { tenantId: tenantA, repositoryId: 7, gitdir: source },
      { tenantId: tenantA, repositoryId: 33, gitdir: source },
    ]);
    database = new DataSource({ type: 'postgres' });
    output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([false, true])('preserves external aliases without copying or updating database (apply=%s)', async (apply) => {
    const transaction = jest.spyOn(database, 'transaction').mockResolvedValue([
      { id: 7, gitdir: source },
      { id: 33, gitdir: source },
    ]);

    await migrateTenantGit(database, tenantA, apply);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createTenantGitCopy).not.toHaveBeenCalled();
    expect(output).toHaveBeenNthCalledWith(1, JSON.stringify({ repoId: 7, operation: 'external-read-only-preserved' }) + '\n');
    expect(output).toHaveBeenNthCalledWith(2, JSON.stringify({ repoId: 33, operation: 'external-read-only-preserved' }) + '\n');
  });

  it('does not import an external path with a mismatching tenant', async () => {
    jest.spyOn(database, 'transaction').mockResolvedValue([{ id: 7, gitdir: source }]);
    await expect(migrateTenantGit(database, tenantB, true)).rejects.toThrow();
    expect(createTenantGitCopy).not.toHaveBeenCalled();
  });

  it('does not import an external path missing from the explicit repository allowlist', async () => {
    jest.spyOn(database, 'transaction').mockResolvedValue([{ id: 16, gitdir: `${externalRoot}/unmapped.git` }]);
    await expect(migrateTenantGit(database, tenantA, true)).rejects.toThrow();
    expect(createTenantGitCopy).not.toHaveBeenCalled();
  });

  it('blocks direct cleanup of an external source even for a different tenant', async () => {
    await expect(removeTenantGitCopy(tenantB, source)).rejects.toThrow('Внешний репозиторий доступен только для чтения');
  });
});
