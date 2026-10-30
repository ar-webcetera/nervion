import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { secret } from './config.mjs';
import { checkPrecutoverClient } from './preflight.mjs';

export const migrationSources = Object.freeze(['dist/platform/platform-data-source.js', 'dist/tenant-data-source.js']);
export const baseline = JSON.parse(readFileSync(new URL('./legacy-baseline-v1.json', import.meta.url), 'utf8'));

export function migrationEnvironment(source, readSecret = secret) {
  const env = { ...source };
  if (env.TENANCY_ENABLED !== 'true' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.TENANCY_BOOTSTRAP_TENANT_ID || '')) throw new Error('Tenant migration context is required');
  if (!['precutover', 'live'].includes(env.NERVION_DEPLOYMENT_PHASE)) throw new Error('Explicit deployment phase is required');
  if (env.NERVION_DEPLOYMENT_PHASE === 'precutover' && env.TENANT_JOBS_WORKER_ENABLED !== 'false') throw new Error('Precutover workers must be disabled');
  const expected = {
    POSTGRES_DB: 'nervion_data_1', POSTGRES_USER: 'nervion_data', MIGRATION_POSTGRES_USER: 'nervion_data_migrator',
    PLATFORM_POSTGRES_DB: 'nervion_platform', PLATFORM_POSTGRES_USER: 'nervion_platform', PLATFORM_MIGRATION_POSTGRES_USER: 'nervion_platform_migrator',
    MIGRATION_POSTGRES_HOST: 'postgres', PLATFORM_MIGRATION_POSTGRES_HOST: 'postgres',
    MIGRATION_POSTGRES_PORT: '5432', PLATFORM_MIGRATION_POSTGRES_PORT: '5432',
  };
  if (Object.entries(expected).some(([key, value]) => env[key] !== value)) throw new Error('Unexpected migration database or role');
  env.MIGRATION_POSTGRES_PASSWORD = readSecret('data_migrator_password');
  env.PLATFORM_MIGRATION_POSTGRES_PASSWORD = readSecret('platform_migrator_password');
  delete env.POSTGRES_PASSWORD; delete env.PLATFORM_POSTGRES_PASSWORD;
  return env;
}

export function assertBaseline(applied, tables) {
  const timestamps = new Set(applied.map((row) => String(row.timestamp)));
  if (baseline.requiredMigrationTimestamps.some((timestamp) => !timestamps.has(timestamp))) throw new Error('Legacy baseline v1 is incomplete; prepare the restored copy separately');
  const names = new Set(tables.map((row) => row.name));
  if (baseline.requiredBusinessTables.some((name) => !names.has(name)) || tables.some((row) => row.name.startsWith('platform_'))) throw new Error('Unexpected business schema');
  if (tables.some((row) => row.owner !== 'nervion_data_migrator')) throw new Error('Business schema ownership is not assigned to the data migrator');
}

async function preflight(client, database, user) {
  const { rows: [row] } = await client.query(`SELECT current_database() AS database, current_user AS username,
    (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole) AS privileged,
    pg_get_userbyid(d.datdba) AS owner, current_setting('shared_preload_libraries') AS preload
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`);
  if (!row || row.database !== database || row.username !== user || row.owner !== user || row.privileged || !row.preload.split(',').map((v) => v.trim()).includes('pg_stat_statements')) throw new Error('Migration database preflight failed');
  const { rows: [extensions] } = await client.query("SELECT count(*)::integer AS count FROM pg_extension WHERE extname='pg_stat_statements'");
  if (extensions.count !== 1) throw new Error('Required database extension is missing');
}

async function runSource(source, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/typeorm/cli.js', '-d', source, 'migration:run', '--transaction', source.includes('tenant-data-source') ? 'all' : 'each'], { env, stdio: 'inherit' });
    let interrupted = false;
    const term = () => { interrupted = true; child.kill('SIGTERM'); };
    const interrupt = () => { interrupted = true; child.kill('SIGINT'); };
    process.on('SIGTERM', term); process.on('SIGINT', interrupt);
    const cleanup = () => { process.off('SIGTERM', term); process.off('SIGINT', interrupt); };
    child.once('error', () => { cleanup(); reject(new Error('Migration process could not start')); });
    child.once('exit', (code) => { cleanup(); code === 0 && !interrupted ? resolve() : reject(new Error('Migration process failed')); });
  });
}

async function main() {
  const env = migrationEnvironment(process.env);
  const initialize = process.argv[2] === '--bootstrap-schema';
  if (process.argv.length > (initialize ? 3 : 2) || (process.argv[2] && !initialize) || (initialize && env.NERVION_DEPLOYMENT_PHASE !== 'precutover')) throw new Error('Unsupported migration mode');
  const { Client } = createRequire('/app/package.json')('pg');
  const clients = ['', 'PLATFORM_'].map((prefix) => new Client({ host: env[`${prefix}MIGRATION_POSTGRES_HOST`],
    port: 5432, user: env[`${prefix}MIGRATION_POSTGRES_USER`], password: env[`${prefix}MIGRATION_POSTGRES_PASSWORD`],
    database: env[`${prefix}POSTGRES_DB`], connectionTimeoutMillis: 10_000, query_timeout: 15_000,
    application_name: 'nervion-tenant-migration-preflight' }));
  try {
    for (const [index, prefix] of ['', 'PLATFORM_'].entries()) {
      await clients[index].connect();
      await preflight(clients[index], env[`${prefix}POSTGRES_DB`], env[`${prefix}MIGRATION_POSTGRES_USER`]);
    }
    const { rows: [lock] } = await clients[0].query("SELECT pg_try_advisory_lock(hashtextextended('nervion-production-tenant-migrations', 0)) AS acquired");
    if (!lock.acquired) throw new Error('Another tenant migration job is active');
    if (initialize) {
      const { rows: [existing] } = await clients[1].query("SELECT to_regclass('public.platform_tenants') IS NOT NULL AS present");
      if (existing.present) {
        const { rows: [count] } = await clients[1].query('SELECT count(*)::integer AS total FROM platform_tenants');
        if (count.total !== 0) throw new Error('Bootstrap-schema mode cannot run for an existing tenant');
      }
    } else if (env.NERVION_DEPLOYMENT_PHASE === 'precutover') {
      // Run before DDL. An empty/unprepared platform DB is not a release.
      await checkPrecutoverClient(clients[1], env.TENANCY_BOOTSTRAP_TENANT_ID);
    }
    const applied = await clients[0].query('SELECT timestamp::text AS timestamp FROM public.migrations');
    const tables = await clients[0].query(`SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`);
    assertBaseline(applied.rows, tables.rows);
    for (const source of migrationSources) await runSource(source, env);
    if (!initialize && env.NERVION_DEPLOYMENT_PHASE === 'precutover') await checkPrecutoverClient(clients[1], env.TENANCY_BOOTSTRAP_TENANT_ID);
  } finally { await Promise.all(clients.map((client) => client.end())); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Detailed CLI output belongs only in the runner's private migration log.
  console.error('Tenant-only migration failed; no runtime deployment is authorized'); process.exitCode = 1;
});
