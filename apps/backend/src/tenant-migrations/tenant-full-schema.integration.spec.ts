import { resolve } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { Users } from '../users/entities/users.entity';
import { Projects } from '../projects/entities/project.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { IsolateTenantData1793318400000 } from './1793318400000-isolate-tenant-data';
import { TenantMailOutbox1793500000000 } from './1793500000000-TenantMailOutbox';
import { MonitorJobRetention1793500001000 } from './1793500001000-monitor-job-retention';

const migrationUrl = process.env.TENANCY_FULL_SCHEMA_DATABASE_URL;
const runtimeUrl = process.env.TENANCY_FULL_SCHEMA_RUNTIME_DATABASE_URL;
const integration = migrationUrl && runtimeUrl ? describe : describe.skip;
const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

integration('Tenant migration with the complete production schema and TypeORM entities', () => {
  let migration: DataSource;
  let runtime: DataSource;
  const fixtures = new Map<string, { taskId: number; projectId: number }>();
  const withTenant = <T>(tenant: string, callback: (manager: EntityManager) => Promise<T>) =>
    runtime.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return callback(manager);
    });

  beforeAll(async () => {
    const migrator = new URL(migrationUrl!);
    const app = new URL(runtimeUrl!);
    if (
      !/^\/nervion_tenant_test_[a-z0-9_]+$/.test(migrator.pathname) ||
      migrator.pathname !== app.pathname ||
      migrator.username === app.username
    ) {
      throw new Error('Use a new disposable nervion_tenant_test_* database with separate migration/runtime roles.');
    }
    migration = await new DataSource({
      type: 'postgres',
      url: migrationUrl,
      synchronize: false,
      migrations: [resolve(__dirname, '../migrations/[0-9]*.ts')],
    }).initialize();
    const existing: { name: string }[] = await migration.query(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (existing.length) throw new Error('Full-schema migration requires an empty disposable database.');
    await migration.runMigrations({ transaction: 'each' });
    const previous = {
      TENANCY_ENABLED: process.env.TENANCY_ENABLED,
      TENANCY_BOOTSTRAP_TENANT_ID: process.env.TENANCY_BOOTSTRAP_TENANT_ID,
      POSTGRES_USER: process.env.POSTGRES_USER,
      MIGRATION_POSTGRES_USER: process.env.MIGRATION_POSTGRES_USER,
    };
    try {
      process.env.TENANCY_ENABLED = 'true';
      process.env.TENANCY_BOOTSTRAP_TENANT_ID = tenantA;
      process.env.POSTGRES_USER = decodeURIComponent(app.username);
      process.env.MIGRATION_POSTGRES_USER = decodeURIComponent(migrator.username);
      const runner = migration.createQueryRunner();
      await runner.connect();
      try {
        // Match deployment's per-migration commits: PostgreSQL enum additions
        // must commit before a later migration or runtime can use new values.
        for (const step of [
          new IsolateTenantData1793318400000(),
          new TenantMailOutbox1793500000000(),
          new MonitorJobRetention1793500001000(),
        ]) {
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
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    runtime = await new DataSource({
      type: 'postgres',
      url: runtimeUrl,
      synchronize: false,
      entities: [resolve(__dirname, '../**/*.entity.ts')],
    }).initialize();
  }, 60000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (migration?.isInitialized) await migration.destroy();
  });

  it('covers every entity and generated many-to-many table with forced RLS', async () => {
    const rows: { name: string; secure: boolean }[] = await runtime.query(`
      SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS secure
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'migrations'
    `);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.every((row) => row.secure)).toBe(true);
    const tables = new Set(rows.map((row) => row.name));
    expect(runtime.entityMetadatas.every((metadata) => tables.has(metadata.tableName))).toBe(true);
  });

  it('supports unchanged TypeORM save, generated junction writes and relation loading', async () => {
    for (const [tenantId, name] of [
      [tenantA, 'A'],
      [tenantB, 'B'],
    ]) {
      await withTenant(tenantId, async (manager) => {
        if (tenantId === tenantB)
          await manager.query(`INSERT INTO task_stages(id,title,position,protected) VALUES ('open','Открыто',1,true)`);
        const user = await manager
          .getRepository(Users)
          .save({ email: 'shared@example.test', first_name: name, last_name: 'Test' });
        const project = await manager.getRepository(Projects).save({ name: 'Shared project' });
        const saved = await manager
          .getRepository(Tasks)
          .save({ title: `Task of ${name}`, project_id: project.id, responsible_id: user.id, participants: [user] });
        fixtures.set(tenantId, { taskId: saved.id, projectId: project.id });
        const task = await manager
          .getRepository(Tasks)
          .findOneOrFail({ where: { id: saved.id }, relations: { project: true, responsible: true, participants: true } });
        expect(task.title).toBe(`Task of ${name}`);
        expect(task.responsible?.first_name).toBe(name);
        expect(task.participants.map((participant) => participant.first_name)).toEqual([name]);
      });
    }
    expect(await runtime.getRepository(Users).find()).toEqual([]);
  });

  it('keeps real task relations tenant scoped on deletion and rejects missing stages', async () => {
    await withTenant(tenantA, async (manager) => {
      const fixture = fixtures.get(tenantA)!;
      await manager.getRepository(Projects).delete(fixture.projectId);
      const task = await manager.getRepository(Tasks).findOneByOrFail({ id: fixture.taskId });
      expect(task.project_id).toBeNull();
    });
    await withTenant(tenantB, async (manager) => {
      const fixture = fixtures.get(tenantB)!;
      expect((await manager.getRepository(Tasks).findOneByOrFail({ id: fixture.taskId })).project_id).toBe(fixture.projectId);
    });
    await expect(
      withTenant(tenantB, (manager) =>
        manager.getRepository(Tasks).save({ title: 'Invalid stage task', status: 'in_progress', priority: 2 }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('applies the outbox schema, enum additions and monitor-retention index', async () => {
    const enumValues: Array<{ value: string }> = await runtime.query(`
      SELECT enumlabel AS value FROM pg_enum JOIN pg_type ON pg_type.oid = enumtypid
      WHERE typname = 'mail_message_status_enum'
    `);
    expect(enumValues.map((row) => row.value)).toEqual(expect.arrayContaining(['queued', 'sending', 'uncertain']));
    const indexes: Array<{ indexdef: string }> = await runtime.query(`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tenant_monitor_jobs_completed'
    `);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('(tenant_id, completed_at)');
    expect(indexes[0].indexdef).toContain('healthchecks.probe');
    expect(indexes[0].indexdef).toContain('completed');
    expect(await runtime.query('SELECT * FROM mail_outbox')).toEqual([]);
    await expect(runtime.query('INSERT INTO mail_outbox(message_id) VALUES (7001)')).rejects.toBeDefined();
    await expect(runtime.query('TRUNCATE mail_outbox')).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('keeps the same numeric mail IDs and outbox UUID isolated across tenants', async () => {
    const sharedOutboxId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    for (const [tenant, label] of [
      [tenantA, 'A'],
      [tenantB, 'B'],
    ]) {
      await withTenant(tenant, async (manager) => {
        await manager.query(`INSERT INTO mail_accounts(id, address, display_name) VALUES (7001, 'shared@example.test', $1)`, [
          label,
        ]);
        await manager.query(`INSERT INTO mail_threads(id, account_id, subject) VALUES (7001, 7001, $1)`, [label]);
        await manager.query(`INSERT INTO mail_messages(id, thread_id, direction, from_address, status)
          VALUES (7001, 7001, 'outbound', 'shared@example.test', 'queued')`);
        await manager.query('INSERT INTO mail_outbox(id, message_id) VALUES ($1, 7001)', [sharedOutboxId]);
        expect(await manager.query('SELECT tenant_id, id, message_id, status FROM mail_outbox')).toEqual([
          { tenant_id: tenant, id: sharedOutboxId, message_id: 7001, status: 'queued' },
        ]);
      });
    }
    await expect(
      withTenant(tenantA, (manager) => manager.query('INSERT INTO mail_outbox(message_id) VALUES (7001)')),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      withTenant(tenantA, (manager) => manager.query('UPDATE mail_outbox SET tenant_id = $1', [tenantB])),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    expect(await runtime.query('SELECT * FROM mail_outbox')).toEqual([]);
  });

  it('rejects cross-tenant outbox references and cascades only the owning tenant', async () => {
    await withTenant(tenantB, (manager) =>
      manager.query(`INSERT INTO mail_messages(id, thread_id, direction, from_address, status)
      VALUES (7002, 7001, 'outbound', 'shared@example.test', 'queued')`),
    );
    await expect(
      withTenant(tenantA, (manager) => manager.query('INSERT INTO mail_outbox(message_id) VALUES (7002)')),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await withTenant(tenantA, async (manager) => {
      await manager.query('DELETE FROM mail_messages WHERE id = 7001');
      expect(await manager.query('SELECT * FROM mail_outbox')).toEqual([]);
    });
    expect(await withTenant(tenantB, (manager) => manager.query('SELECT message_id FROM mail_outbox'))).toEqual([
      { message_id: 7001 },
    ]);
  });
});
