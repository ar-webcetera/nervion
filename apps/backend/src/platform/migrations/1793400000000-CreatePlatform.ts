import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatform1793400000000 implements MigrationInterface {
  name = 'CreatePlatform1793400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_tenants (
        id uuid PRIMARY KEY,
        slug varchar NOT NULL UNIQUE,
        hostname varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        status varchar NOT NULL CHECK (status IN ('provisioning','active','read_only','suspended','cancelled','failed')),
        plan varchar NOT NULL,
        seat_limit integer NOT NULL CHECK (seat_limit > 0),
        paid_until timestamptz,
        grace_until timestamptz,
        retention_until timestamptz,
        database_shard_id varchar NOT NULL,
        storage_namespace varchar NOT NULL UNIQUE,
        feature_flags jsonb NOT NULL DEFAULT '{}',
        provisioning_admin jsonb,
        provisioning_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE platform_identities (
        id uuid PRIMARY KEY,
        email varchar NOT NULL UNIQUE CHECK (email = lower(trim(email))),
        password_hash text,
        credential_origin_tenant_id uuid,
        email_verified_at timestamptz,
        session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
        mfa_settings jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE platform_memberships (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES platform_tenants(id),
        identity_id uuid NOT NULL REFERENCES platform_identities(id),
        local_user_id integer,
        role varchar NOT NULL CHECK (role IN ('admin','employee','guest')),
        status varchar NOT NULL CHECK (status IN ('reserved','active','archived')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, identity_id),
        UNIQUE (tenant_id, local_user_id)
      );
      CREATE INDEX platform_memberships_seats ON platform_memberships (tenant_id, status);
      CREATE TABLE platform_audit (
        id bigserial PRIMARY KEY,
        actor varchar NOT NULL,
        action varchar NOT NULL,
        tenant_id uuid REFERENCES platform_tenants(id),
        details jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX platform_audit_login_rate ON platform_audit (actor, action, created_at);
      CREATE TABLE platform_admin_sessions (
        token_hash varchar PRIMARY KEY,
        email varchar NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX platform_admin_sessions_expiry ON platform_admin_sessions (expires_at);
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Platform rollback requires an explicit backup restore; automatic data deletion is prohibited.'),
    );
  }
}
