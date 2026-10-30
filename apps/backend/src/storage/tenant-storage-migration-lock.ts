import { DataSource } from 'typeorm';

interface StorageMigrationLockRow {
  acquired?: boolean;
  pid?: number;
  held?: boolean;
}

export interface StorageMigrationLockConnection {
  connect(): Promise<object | void>;
  query(sql: string, parameters: string[]): Promise<StorageMigrationLockRow[]>;
  release(): Promise<void>;
}

const LOCK_DOMAIN = 'nervion-storage-migration';
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function storageMigrationDatabase(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: required('MIGRATION_POSTGRES_HOST'),
    port: Number(process.env.MIGRATION_POSTGRES_PORT || 5432),
    username: required('MIGRATION_POSTGRES_USER'),
    password: required('MIGRATION_POSTGRES_PASSWORD'),
    database: required('POSTGRES_DB'),
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { max: 2, connectionTimeoutMillis: 10_000, query_timeout: 15_000 },
  });
}

export function assertStorageMigrationFreeze(): void {
  if (process.env.TENANCY_STORAGE_WRITES_STOPPED !== 'true' || process.env.TENANCY_STORAGE_EXCLUSIVE_WRITER !== 'true') {
    throw new Error(
      'Stop every storage writer and confirm one migration operator: TENANCY_STORAGE_WRITES_STOPPED=true and TENANCY_STORAGE_EXCLUSIVE_WRITER=true are required',
    );
  }
}

/** Session lock requires a direct PostgreSQL connection, never transaction pooling.
 * It serializes these CLI jobs, not arbitrary storage clients. The operational
 * all-writer freeze remains mandatory, including when a connection is lost.
 */
export async function runWithStorageMigrationLock<T>(
  runner: StorageMigrationLockConnection,
  tenantId: string,
  run: (assertWriter: () => Promise<void>) => Promise<T>,
): Promise<T> {
  assertStorageMigrationFreeze();
  await runner.connect();
  let acquired = false;
  try {
    const rows = await runner.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired, pg_backend_pid() AS pid',
      [LOCK_DOMAIN, tenantId],
    );
    acquired = rows[0]?.acquired === true;
    if (!acquired) throw new Error('Another storage migration owns this tenant lock');
    const pid = rows[0].pid;
    if (!pid || !Number.isSafeInteger(pid)) throw new Error('Storage migration session identity unavailable');
    const assertWriter = async (): Promise<void> => {
      assertStorageMigrationFreeze();
      const status = await runner.query(
        `SELECT pg_backend_pid() AS pid, EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND pid=pg_backend_pid()
          AND classid=(hashtext($1)::bigint & 4294967295)::oid
          AND objid=(hashtext($2)::bigint & 4294967295)::oid AND objsubid=2
        ) AS held`,
        [LOCK_DOMAIN, tenantId],
      );
      if (status[0]?.pid !== pid || status[0]?.held !== true) throw new Error('Storage migration lock connection was lost');
    };
    await assertWriter();
    return await run(assertWriter);
  } finally {
    try {
      if (acquired) await runner.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [LOCK_DOMAIN, tenantId]);
    } finally {
      await runner.release();
    }
  }
}
