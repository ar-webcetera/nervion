import { MigrationInterface, QueryRunner } from 'typeorm';

interface BusinessTable {
  name: string;
  oid: number;
  owner: string;
  kind: string;
}

interface TableConstraint {
  name: string;
  table_name: string;
  kind: 'p' | 'u' | 'f' | 'x';
  columns: string[];
  foreign_table: string | null;
  foreign_schema: string | null;
  foreign_columns: string[];
  delete_action: string;
  update_action: string;
  match_type: string;
  deferrable: boolean;
  deferred: boolean;
  nulls_not_distinct: boolean;
}

interface UniqueIndex {
  name: string;
  definition: string;
}

const metadataTables = ['migrations', 'tenant_migrations', 'typeorm_metadata', 'app_secrets'];
const tenantExpression = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";
const identifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const qualified = (name: string): string => `public.${identifier(name)}`;
const columns = (names: string[]): string => names.map(identifier).join(', ');

/** Opt-in, transactional conversion. Roll back from backup, never by removing isolation. */
export class IsolateTenantData1793318400000 implements MigrationInterface {
  name = 'IsolateTenantData1793318400000';

  async up(q: QueryRunner): Promise<void> {
    const tenantId = process.env.TENANCY_BOOTSTRAP_TENANT_ID || '';
    const runtimeRole = process.env.POSTGRES_USER || '';
    if (
      process.env.TENANCY_ENABLED !== 'true' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)
    ) {
      throw new Error('Set TENANCY_ENABLED=true and a valid TENANCY_BOOTSTRAP_TENANT_ID before migration.');
    }
    if (!runtimeRole || runtimeRole === process.env.MIGRATION_POSTGRES_USER) {
      throw new Error('POSTGRES_USER must be a dedicated runtime role, different from MIGRATION_POSTGRES_USER.');
    }
    if (!q.isTransactionActive) throw new Error('Tenant migration must run in one transaction.');

    const versions: { version: number }[] = await q.query(`SELECT current_setting('server_version_num')::integer AS version`);
    if (versions[0].version < 150000) throw new Error('Tenant-scoped SET NULL foreign keys require PostgreSQL 15 or newer.');
    const roles: { unsafe: boolean }[] = await q.query(
      `SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
       OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND pg_has_role(r.oid, d.datdba, 'MEMBER'))
       OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public' AND pg_has_role(r.oid, n.nspowner, 'MEMBER'))
       OR pg_has_role(r.oid, current_user, 'MEMBER') AS unsafe FROM pg_roles r WHERE r.rolname = $1`,
      [runtimeRole],
    );
    if (roles.length !== 1 || roles[0].unsafe) {
      throw new Error('Runtime role must exist, have no privileged attributes and not inherit the migration role.');
    }

    await q.query(`CREATE TABLE public.tenant_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_shard_id text NOT NULL,
      actor_id integer,
      idempotency_key varchar(200) NOT NULL UNIQUE,
      kind varchar(100) NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}',
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      available_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    const tables: BusinessTable[] = await q.query(
      `SELECT c.relname AS name, c.oid::integer AS oid, pg_get_userbyid(c.relowner) AS owner, c.relkind AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
       AND NOT c.relname = ANY($1::text[])
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
       ORDER BY c.relname`,
      [metadataTables],
    );
    const names = tables.map((table) => table.name);
    if (
      !['tasks', 'users', 'projects', 'task_stages'].every((name) => names.includes(name)) ||
      names.some((name) => name.startsWith('platform_'))
    ) {
      throw new Error('Apply all business migrations first and select the data database, not the platform database.');
    }
    if (tables.some((table) => table.kind !== 'r')) {
      throw new Error('Review views, materialized views and partitioned tables before automatic tenant conversion.');
    }
    for (const table of tables) {
      const owners: { member: boolean }[] = await q.query(`SELECT pg_has_role($1, $2, 'MEMBER') AS member`, [
        runtimeRole,
        table.owner,
      ]);
      if (owners[0].member)
        throw new Error(`Runtime role owns or inherits ownership of ${table.name}. Reassign ownership before migration.`);
    }
    await q.query(`SET LOCAL lock_timeout = '15s'`);
    await q.query(`LOCK TABLE ${names.map(qualified).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const existingPolicies: { count: string }[] = await q.query(
      `SELECT count(*)::text AS count FROM pg_policy WHERE polrelid = ANY($1::oid[])`,
      [tables.map((table) => table.oid)],
    );
    if (existingPolicies[0].count !== '0')
      throw new Error('Existing RLS policies require explicit review; refusing to combine permissive policies.');

    const constraints: TableConstraint[] = await q.query(
      `SELECT c.conname AS name, t.relname AS table_name, c.contype AS kind,
         ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum, pos)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.pos)::text[] AS columns,
         ft.relname AS foreign_table, fn.nspname AS foreign_schema,
         ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(attnum, pos)
           JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.pos)::text[] AS foreign_columns,
         c.confdeltype AS delete_action, c.confupdtype AS update_action, c.confmatchtype AS match_type,
         c.condeferrable AS deferrable, c.condeferred AS deferred, COALESCE(i.indnullsnotdistinct, false) AS nulls_not_distinct
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       LEFT JOIN pg_class ft ON ft.oid = c.confrelid LEFT JOIN pg_namespace fn ON fn.oid = ft.relnamespace
       LEFT JOIN pg_index i ON i.indexrelid = c.conindid
       WHERE c.contype IN ('p', 'u', 'f', 'x')
       AND (c.conrelid = ANY($1::oid[]) OR c.confrelid = ANY($1::oid[]))`,
      [tables.map((table) => table.oid)],
    );
    for (const constraint of constraints) {
      if (constraint.kind === 'x') throw new Error(`Exclusion constraint ${constraint.name} requires a tenant-aware migration.`);
      if (
        constraint.kind === 'f' &&
        (!names.includes(constraint.table_name) ||
          constraint.foreign_schema !== 'public' ||
          !names.includes(constraint.foreign_table || ''))
      ) {
        throw new Error(`Foreign key ${constraint.name} crosses the business schema boundary.`);
      }
      if (constraint.kind === 'f' && ['n', 'd'].includes(constraint.update_action)) {
        throw new Error(`ON UPDATE SET NULL/DEFAULT for ${constraint.name} requires explicit handling to preserve tenant_id.`);
      }
      if (constraint.kind === 'f' && constraint.match_type !== 's') {
        throw new Error(
          `Non-SIMPLE foreign key ${constraint.name} requires explicit handling of nullable tenant-scoped relations.`,
        );
      }
      if (constraint.columns.includes('tenant_id'))
        throw new Error('A partially tenant-converted schema requires explicit review.');
    }
    const indexes: UniqueIndex[] = await q.query(
      `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid = ANY($1::oid[]) AND i.indisunique
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x'))`,
      [tables.map((table) => table.oid)],
    );

    for (const table of tables) {
      await q.query(`ALTER TABLE ${qualified(table.name)} ADD COLUMN tenant_id uuid`);
      await q.query(`UPDATE ${qualified(table.name)} SET tenant_id = $1::uuid`, [tenantId]);
      await q.query(
        `ALTER TABLE ${qualified(table.name)} ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN tenant_id SET DEFAULT ${tenantExpression}`,
      );
    }
    // Drop all FKs first, including the ones backed by standalone unique indexes.
    for (const constraint of constraints.filter((constraint) => constraint.kind === 'f')) {
      await q.query(`ALTER TABLE ${qualified(constraint.table_name)} DROP CONSTRAINT ${identifier(constraint.name)}`);
    }
    for (const constraint of constraints.filter((constraint) => ['p', 'u'].includes(constraint.kind))) {
      await q.query(`ALTER TABLE ${qualified(constraint.table_name)} DROP CONSTRAINT ${identifier(constraint.name)}`);
      const type =
        constraint.kind === 'p' ? 'PRIMARY KEY' : `UNIQUE${constraint.nulls_not_distinct ? ' NULLS NOT DISTINCT' : ''}`;
      const deferral = constraint.deferrable ? ` DEFERRABLE INITIALLY ${constraint.deferred ? 'DEFERRED' : 'IMMEDIATE'}` : '';
      await q.query(
        `ALTER TABLE ${qualified(constraint.table_name)} ADD CONSTRAINT ${identifier(constraint.name)} ${type} (${columns(['tenant_id', ...constraint.columns])})${deferral}`,
      );
    }
    for (const index of indexes) {
      // pg_get_indexdef preserves expressions, predicates, INCLUDE and NULLS NOT DISTINCT.
      const tenantDefinition = index.definition.replace(/\bUSING btree \(/, 'USING btree (tenant_id, ');
      if (tenantDefinition === index.definition) throw new Error(`Unsupported unique index ${index.name}.`);
      await q.query(`DROP INDEX public.${identifier(index.name)}`);
      await q.query(tenantDefinition);
    }
    for (const constraint of constraints.filter((constraint) => constraint.kind === 'f')) {
      const actions: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
      const deleteColumns = ['n', 'd'].includes(constraint.delete_action) ? ` (${columns(constraint.columns)})` : '';
      const deferral = constraint.deferrable ? ` DEFERRABLE INITIALLY ${constraint.deferred ? 'DEFERRED' : 'IMMEDIATE'}` : '';
      await q.query(
        `ALTER TABLE ${qualified(constraint.table_name)} ADD CONSTRAINT ${identifier(constraint.name)}
         FOREIGN KEY (${columns(['tenant_id', ...constraint.columns])})
         REFERENCES ${qualified(constraint.foreign_table!)} (${columns(['tenant_id', ...constraint.foreign_columns])})
         MATCH SIMPLE ON DELETE ${actions[constraint.delete_action]}${deleteColumns}
         ON UPDATE ${actions[constraint.update_action]}${deferral}`,
      );
    }

    await q.query(`CREATE OR REPLACE FUNCTION public.validate_task_stage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.business_kind = 'production' THEN
          PERFORM id FROM public.task_stages WHERE tenant_id = NEW.tenant_id AND id = NEW.status FOR KEY SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Этап задачи удалён. Обновите доску.' USING ERRCODE = '23503'; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${identifier(runtimeRole)}, PUBLIC`);
    await q.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${identifier(runtimeRole)}, PUBLIC`);
    await q.query(`REVOKE CREATE ON SCHEMA public FROM ${identifier(runtimeRole)}, PUBLIC`);
    await q.query(`GRANT USAGE ON SCHEMA public TO ${identifier(runtimeRole)}`);
    for (const table of tables) {
      await q.query(`ALTER TABLE ${qualified(table.name)} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${qualified(table.name)} FORCE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY tenant_isolation ON ${qualified(table.name)} FOR ALL
        USING (tenant_id = ${tenantExpression}) WITH CHECK (tenant_id = ${tenantExpression})`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${qualified(table.name)} TO ${identifier(runtimeRole)}`);
    }
    await q.query(
      `CREATE INDEX tenant_jobs_pending ON public.tenant_jobs (tenant_id, available_at, created_at) WHERE status = 'pending'`,
    );
    await q.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier(runtimeRole)}`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Tenant isolation cannot be safely reverted after onboarding clients. Restore the pre-migration backup into an isolated database.',
      ),
    );
  }
}
