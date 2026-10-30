import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantMailOutbox1793500000000 implements MigrationInterface {
  name = 'TenantMailOutbox1793500000000';

  async up(q: QueryRunner): Promise<void> {
    const role = process.env.POSTGRES_USER || '';
    if (process.env.TENANCY_ENABLED !== 'true' || !role || role === process.env.MIGRATION_POSTGRES_USER) throw new Error('Dedicated tenant runtime role is required');
    const safe: Array<{ safe: boolean }> = await q.query(`SELECT NOT (rolsuper OR rolbypassrls OR pg_has_role(oid, current_user, 'MEMBER')) AS safe FROM pg_roles WHERE rolname = $1`, [role]);
    if (safe[0]?.safe !== true) throw new Error('Unsafe mail runtime role');
    for (const value of ['queued', 'sending', 'uncertain']) await q.query(`ALTER TYPE mail_message_status_enum ADD VALUE IF NOT EXISTS '${value}'`);
    const tenant = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";
    await q.query(`CREATE TABLE mail_outbox (
      tenant_id uuid NOT NULL DEFAULT ${tenant},
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      message_id integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','uncertain')),
      claimed_at timestamptz,
      last_error varchar(255),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, message_id),
      FOREIGN KEY (tenant_id, message_id) REFERENCES mail_messages (tenant_id, id) ON DELETE CASCADE
    )`);
    await q.query('CREATE INDEX mail_outbox_queued ON mail_outbox (tenant_id, created_at) WHERE status IN (\'queued\', \'sending\')');
    await q.query('ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY');
    await q.query('ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY');
    await q.query(`CREATE POLICY tenant_isolation ON mail_outbox FOR ALL USING (tenant_id = ${tenant}) WITH CHECK (tenant_id = ${tenant})`);
    await q.query(`REVOKE ALL ON mail_outbox FROM PUBLIC`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON mail_outbox TO "${role.replace(/"/g, '""')}"`);
  }

  async down(): Promise<void> { throw new Error('Restore a verified backup to roll back tenant mail schema'); }
}
