import { DataSource, EntityManager } from 'typeorm';
import { IsolateTenantData1793318400000 } from './1793318400000-isolate-tenant-data';
import { TenantMailOutbox1793500000000 } from './1793500000000-TenantMailOutbox';
import { MonitorJobRetention1793500001000 } from './1793500001000-monitor-job-retention';

// Dedicated disposable databases only. Run against PostgreSQL AND PgBouncer.
const migrationUrl = process.env.TENANCY_TEST_DATABASE_URL;
const runtimeUrl = process.env.TENANCY_TEST_RUNTIME_DATABASE_URL;
const integration = migrationUrl && runtimeUrl ? describe : describe.skip;
const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

integration('PostgreSQL tenant isolation and transaction pooling', () => {
  let migration: DataSource;
  let runtime: DataSource;

  const withTenant = <T>(tenantId: string, run: (manager: EntityManager) => Promise<T>): Promise<T> =>
    runtime.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return run(manager);
    });

  beforeAll(async () => {
    const migrationConnection = new URL(migrationUrl!);
    const runtimeConnection = new URL(runtimeUrl!);
    if (
      !/^\/nervion_tenant_test_[a-z0-9_]+$/.test(migrationConnection.pathname) ||
      migrationConnection.pathname !== runtimeConnection.pathname
    ) {
      throw new Error('Tests require the same disposable nervion_tenant_test_* database for migration and runtime.');
    }
    if (migrationConnection.username === runtimeConnection.username)
      throw new Error('Use separate migration and unprivileged runtime roles.');
    migration = await new DataSource({ type: 'postgres', url: migrationUrl, synchronize: false }).initialize();
    runtime = await new DataSource({ type: 'postgres', url: runtimeUrl, synchronize: false, extra: { max: 1 } }).initialize();
    const existing: { name: string }[] = await migration.query(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (existing.length) throw new Error('Disposable test database must be empty. Tests do not delete existing tables.');
    const previous = {
      enabled: process.env.TENANCY_ENABLED,
      tenant: process.env.TENANCY_BOOTSTRAP_TENANT_ID,
      runtime: process.env.POSTGRES_USER,
      migrator: process.env.MIGRATION_POSTGRES_USER,
    };
    try {
      process.env.TENANCY_ENABLED = 'true';
      process.env.TENANCY_BOOTSTRAP_TENANT_ID = tenantA;
      process.env.POSTGRES_USER = decodeURIComponent(runtimeConnection.username);
      process.env.MIGRATION_POSTGRES_USER = decodeURIComponent(migrationConnection.username);
      const runner = migration.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE);
          CREATE TABLE projects (id serial PRIMARY KEY, name text UNIQUE);
          CREATE TABLE task_stages (id text PRIMARY KEY, title text);
          CREATE UNIQUE INDEX task_stage_title ON task_stages (lower(title));
          CREATE TABLE tasks (id serial PRIMARY KEY, title text, status text DEFAULT 'open', business_kind text DEFAULT 'production',
            project_id integer REFERENCES projects(id) ON DELETE SET NULL, author_id integer REFERENCES users(id) ON DELETE CASCADE);
          CREATE UNIQUE INDEX active_task_title ON tasks (lower(title)) WHERE status = 'open';
          CREATE TABLE task_users (task_id integer REFERENCES tasks(id) ON DELETE CASCADE,
            user_id integer REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (task_id, user_id));
          CREATE TYPE mail_message_status_enum AS ENUM ('received', 'sent', 'failed', 'draft');
          CREATE TABLE mail_messages (id serial PRIMARY KEY, status mail_message_status_enum NOT NULL DEFAULT 'received');
          INSERT INTO users(id, email) VALUES (900, 'legacy@example.test');
          INSERT INTO task_stages(id, title) VALUES ('open', 'Open');`);
        await new IsolateTenantData1793318400000().up(runner);
        await runner.commitTransaction();
        for (const step of [new TenantMailOutbox1793500000000(), new MonitorJobRetention1793500001000()]) {
          await runner.startTransaction();
          await step.up(runner);
          await runner.commitTransaction();
        }
      } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    } finally {
      for (const [key, value] of Object.entries({
        TENANCY_ENABLED: previous.enabled,
        TENANCY_BOOTSTRAP_TENANT_ID: previous.tenant,
        POSTGRES_USER: previous.runtime,
        MIGRATION_POSTGRES_USER: previous.migrator,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (migration?.isInitialized) await migration.destroy();
  });

  it('backfills existing data and fails closed without context', async () => {
    expect(await runtime.query('SELECT * FROM users')).toEqual([]);
    expect(await withTenant(tenantA, (manager) => manager.query('SELECT id FROM users'))).toEqual([{ id: 900 }]);
    expect(await withTenant(tenantB, (manager) => manager.query('SELECT id FROM users'))).toEqual([]);
    await expect(runtime.query(`INSERT INTO users(email) VALUES ('no-context@example.test')`)).rejects.toBeDefined();
  });

  it('allows identical primary, unique and expression keys in different tenants', async () => {
    for (const tenant of [tenantA, tenantB]) {
      await withTenant(tenant, async (manager) => {
        await manager.query(`INSERT INTO users(id, email) VALUES (1, 'same@example.test')`);
        await manager.query(`INSERT INTO projects(id, name) VALUES (1, 'Same project')`);
        await manager.query(`INSERT INTO task_stages(id, title) VALUES ('custom', 'Same title')`);
        await manager.query(`INSERT INTO tasks(id, title, author_id, project_id) VALUES (1, 'Same task', 1, 1)`);
        await manager.query(`INSERT INTO task_users(task_id, user_id) VALUES (1, 1)`);
      });
    }
    await expect(
      withTenant(tenantA, (manager) => manager.query(`INSERT INTO task_stages(id, title) VALUES ('duplicate', 'SAME TITLE')`)),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      withTenant(tenantA, (manager) => manager.query(`INSERT INTO tasks(id, title) VALUES (2, 'SAME TASK')`)),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('rejects foreign-tenant relations and changes to tenant_id', async () => {
    await withTenant(tenantB, (manager) => manager.query(`INSERT INTO users(id, email) VALUES (42, 'only-b@example.test')`));
    await expect(
      withTenant(tenantA, (manager) => manager.query(`INSERT INTO tasks(id, title, author_id) VALUES (2, 'Forbidden', 42)`)),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(
      withTenant(tenantA, (manager) => manager.query(`UPDATE users SET tenant_id = $1 WHERE id = 1`, [tenantB])),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('preserves nullable relations and cascades without touching another tenant', async () => {
    await withTenant(tenantA, async (manager) => {
      await manager.query(`DELETE FROM projects WHERE id = 1`);
      expect(await manager.query(`SELECT tenant_id, project_id FROM tasks WHERE id = 1`)).toEqual([
        { tenant_id: tenantA, project_id: null },
      ]);
      await manager.query(`DELETE FROM users WHERE id = 1`);
      expect(await manager.query(`SELECT * FROM task_users`)).toEqual([]);
    });
    expect(await withTenant(tenantB, (manager) => manager.query(`SELECT project_id FROM tasks WHERE id = 1`))).toEqual([
      { project_id: 1 },
    ]);
  });

  it('clears transaction context after commit and rollback on reused connections', async () => {
    for (let i = 0; i < 6; i++) {
      await withTenant(i % 2 ? tenantA : tenantB, async (manager) => {
        const rows: { tenant_id: string }[] = await manager.query('SELECT tenant_id FROM users');
        expect(rows.every((row) => row.tenant_id === (i % 2 ? tenantA : tenantB))).toBe(true);
      });
      expect(await runtime.query('SELECT * FROM users')).toEqual([]);
    }
    await expect(withTenant(tenantA, () => Promise.reject(new Error('rollback')))).rejects.toThrow('rollback');
    expect(await runtime.query('SELECT * FROM users')).toEqual([]);
    await expect(runtime.query('TRUNCATE users CASCADE')).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('protects outbox writes, uniqueness and foreign keys through the runtime connection', async () => {
    const sharedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    for (const tenant of [tenantA, tenantB]) {
      await withTenant(tenant, async (manager) => {
        await manager.query(`INSERT INTO mail_messages(id, status) VALUES (1, 'queued')`);
        await manager.query('INSERT INTO mail_outbox(id, message_id) VALUES ($1, 1)', [sharedId]);
        expect(await manager.query('SELECT tenant_id, id, message_id FROM mail_outbox')).toEqual([
          { tenant_id: tenant, id: sharedId, message_id: 1 },
        ]);
      });
      expect(await runtime.query('SELECT * FROM mail_outbox')).toEqual([]);
    }
    await withTenant(tenantB, (manager) => manager.query(`INSERT INTO mail_messages(id, status) VALUES (2, 'queued')`));
    await expect(
      withTenant(tenantA, (manager) => manager.query('INSERT INTO mail_outbox(message_id) VALUES (2)')),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(
      withTenant(tenantA, (manager) => manager.query('INSERT INTO mail_outbox(message_id) VALUES (1)')),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(runtime.query('INSERT INTO mail_outbox(message_id) VALUES (1)')).rejects.toBeDefined();
    await expect(
      withTenant(tenantA, (manager) => manager.query('UPDATE mail_outbox SET tenant_id = $1', [tenantB])),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(runtime.query('TRUNCATE mail_outbox')).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('does not leak outbox context after rollback or delete another tenant queue', async () => {
    await expect(
      withTenant(tenantA, async (manager) => {
        await manager.query("UPDATE mail_outbox SET status = 'sending'");
        throw new Error('rollback outbox');
      }),
    ).rejects.toThrow('rollback outbox');
    expect(await runtime.query('SELECT * FROM mail_outbox')).toEqual([]);
    await withTenant(tenantA, async (manager) => {
      expect(await manager.query('SELECT status FROM mail_outbox')).toEqual([{ status: 'queued' }]);
      await manager.query('DELETE FROM mail_messages WHERE id = 1');
      expect(await manager.query('SELECT * FROM mail_outbox')).toEqual([]);
    });
    expect(await withTenant(tenantB, (manager) => manager.query('SELECT message_id, status FROM mail_outbox'))).toEqual([
      { message_id: 1, status: 'queued' },
    ]);
    expect(await runtime.query('SELECT * FROM mail_outbox')).toEqual([]);
  });
});
