import 'reflect-metadata';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { DataSource } from 'typeorm';
import { directoryBytes } from './git-runtime';
import { assertTenantGitDirectory, createTenantGitCopy, gitTenantPath, removeTenantGitCopy } from './git-tenant-storage';
import { assertNoExternalGitCleanup, resolveExternalGitRepository } from './git-external-readonly';

interface GitMigrationRow {
  id: number;
  gitdir: string;
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

/** Operator-only source roots. No HTTP endpoint accepts a filesystem source. */
export async function validateLegacyGitSource(source: string, allowedRoots: string[]): Promise<number> {
  if (!isAbsolute(source) || resolve(source) !== source || (await realpath(source)) !== source)
    throw new Error('Legacy Git source must be a canonical absolute path');
  const roots = await Promise.all(
    allowedRoots.map(async (root) => {
      if (
        !isAbsolute(root) ||
        resolve(root) !== root ||
        root === sep ||
        root === process.env.HOME ||
        (await realpath(root)) !== root
      ) {
        throw new Error('Explicit canonical Git source roots are required');
      }
      return root;
    }),
  );
  if (!roots.some((root) => source.startsWith(`${root}${sep}`)))
    throw new Error('Legacy Git source is outside the authorized roots');
  for (const name of ['objects/info/alternates', 'objects/info/http-alternates', 'commondir', 'gitdir', 'config.worktree']) {
    const exists = await lstat(join(source, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (exists) throw new Error('Shared/worktree Git sources require a separate standalone export');
  }
  if (!(await lstat(join(source, 'objects'))).isDirectory()) throw new Error('Legacy source is not a Git directory');
  return directoryBytes(source);
}

export async function migrateTenantGit(database: DataSource, tenantId: string, apply: boolean): Promise<void> {
  const authorizedRoots = required('GIT_MIGRATION_SOURCE_ROOTS')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  // Validate the target before reading records or making filesystem changes.
  const tenantRoot = dirname(dirname(gitTenantPath(tenantId, '00000000-0000-4000-8000-000000000001')));
  const rows = await database.transaction(async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return manager.query<GitMigrationRow[]>('SELECT id, gitdir FROM repos WHERE tenant_id=$1 ORDER BY id', [tenantId]);
  });
  for (const row of rows) {
    if (resolveExternalGitRepository(tenantId, row.id, row.gitdir)) {
      process.stdout.write(JSON.stringify({ repoId: row.id, operation: 'external-read-only-preserved' }) + '\n');
      continue;
    }
    // An incomplete allowlist must never turn an external source into a static copy.
    assertNoExternalGitCleanup(row.gitdir);
    if (row.gitdir.startsWith(`${tenantRoot}${sep}`)) {
      await assertTenantGitDirectory(tenantId, row.gitdir);
      process.stdout.write(JSON.stringify({ repoId: row.id, operation: 'already-migrated' }) + '\n');
      continue;
    }
    const bytes = await validateLegacyGitSource(row.gitdir, authorizedRoots);
    process.stdout.write(JSON.stringify({ repoId: row.id, operation: apply ? 'copy' : 'plan-copy', bytes }) + '\n');
    if (!apply) continue;
    const gitdir = await createTenantGitCopy(tenantId, { remoteUrl: null, username: '', token: '' }, row.gitdir);
    // A failure leaves an isolated orphan copy, never deletes a legacy source.
    // The separate orphan command reconciles uncertain commits against the DB.
    await database.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const changed = await manager.query<Array<{ id: number }>>(
        'UPDATE repos SET gitdir=$1 WHERE tenant_id=$2 AND id=$3 AND gitdir=$4 RETURNING id',
        [gitdir, tenantId, row.id, row.gitdir],
      );
      if (changed.length !== 1) throw new Error('Repository changed during migration; stop application writes');
    });
  }
}

export async function pruneTenantGitOrphans(database: DataSource, tenantId: string, apply: boolean): Promise<void> {
  const tenantRoot = dirname(dirname(gitTenantPath(tenantId, '00000000-0000-4000-8000-000000000001')));
  if ((await realpath(tenantRoot)) !== tenantRoot) throw new Error('Invalid tenant Git root');
  const rows = await database.transaction(async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return manager.query<GitMigrationRow[]>('SELECT id, gitdir FROM repos WHERE tenant_id=$1', [tenantId]);
  });
  const active = new Set(rows.map((row) => row.gitdir));
  for (const entry of await readdir(tenantRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const gitdir = gitTenantPath(tenantId, entry.name);
    assertNoExternalGitCleanup(gitdir);
    if (active.has(gitdir)) continue;
    const stat = await lstat(dirname(gitdir));
    if (Date.now() - stat.mtimeMs < 2 * 60 * 60 * 1000) continue;
    process.stdout.write(
      JSON.stringify({ operation: apply ? 'remove-orphan' : 'plan-remove-orphan', repositoryKey: entry.name }) + '\n',
    );
    if (apply) await removeTenantGitCopy(tenantId, gitdir);
  }
}

async function main(): Promise<void> {
  (await import('dotenv')).config();
  const flags = new Set(process.argv.slice(2));
  if (
    [...flags].some((flag) => !['--dry-run', '--apply', '--prune-orphans'].includes(flag)) ||
    (flags.has('--dry-run') && flags.has('--apply'))
  ) {
    throw new Error('Usage: tenant:git:migrate [--dry-run | --apply] [--prune-orphans]');
  }
  const apply = flags.has('--apply');
  if (apply && process.env.GIT_MIGRATION_WRITES_STOPPED !== 'true')
    throw new Error('Stop application and worker writes, then set GIT_MIGRATION_WRITES_STOPPED=true');
  const tenantId = required('TENANCY_BOOTSTRAP_TENANT_ID').toLowerCase();
  gitTenantPath(tenantId, '00000000-0000-4000-8000-000000000001');
  const database = new DataSource({
    type: 'postgres',
    host: required('MIGRATION_POSTGRES_HOST'),
    port: Number(process.env.MIGRATION_POSTGRES_PORT || 5432),
    username: required('MIGRATION_POSTGRES_USER'),
    password: required('MIGRATION_POSTGRES_PASSWORD'),
    database: required('POSTGRES_DB'),
    logging: false,
    synchronize: false,
    migrationsRun: false,
  });
  await database.initialize();
  try {
    if (flags.has('--prune-orphans')) await pruneTenantGitOrphans(database, tenantId, apply);
    else await migrateTenantGit(database, tenantId, apply);
  } finally {
    await database.destroy();
  }
}

if (require.main === module) {
  void main().catch(() => {
    // No driver error or Git stderr reaches logs: these can contain credentials.
    process.stderr.write(
      'Git migration failed. Check the selected tenant, source roots, database access and storage configuration.\n',
    );
    process.exitCode = 1;
  });
}
