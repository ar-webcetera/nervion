import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1775700000000 implements MigrationInterface {
  name = 'CreateAuditLogs1775700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_type_enum" AS ENUM(
        'auth.login_success',
        'auth.login_failed',
        'auth.logout',
        'tasks.created',
        'tasks.updated',
        'tasks.deleted',
        'tasks.completed',
        'tasks.uncompleted',
        'tasks.recurrence_changed',
        'projects.created',
        'projects.updated',
        'projects.deleted',
        'projects.members_updated',
        'users.created',
        'users.updated',
        'users.archived',
        'users.restored',
        'api_tokens.created',
        'api_tokens.deleted',
        'timelogs.created',
        'timelogs.updated',
        'timelogs.deleted'
      )`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_entity_type_enum" AS ENUM(
        'auth',
        'task',
        'project',
        'user',
        'api_token',
        'timelog'
      )`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_source_type_enum" AS ENUM(
        'web',
        'api_token',
        'system'
      )`,
    );
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" SERIAL NOT NULL,
        "action_type" "public"."audit_logs_action_type_enum" NOT NULL,
        "entity_type" "public"."audit_logs_entity_type_enum" NOT NULL,
        "entity_id" character varying(128),
        "entity_label" character varying(255),
        "summary" character varying(500) NOT NULL,
        "before_payload" jsonb,
        "after_payload" jsonb,
        "diff_payload" jsonb,
        "metadata_payload" jsonb,
        "source_type" "public"."audit_logs_source_type_enum" NOT NULL DEFAULT 'web',
        "actor_id" integer,
        "actor_name" character varying(255),
        "project_id" integer,
        "task_id" integer,
        "request_id" character varying(64),
        "request_method" character varying(16),
        "request_path" character varying(512),
        "ip_address" character varying(64),
        "user_agent" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_actor_id" ON "audit_logs" ("actor_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_action_type" ON "audit_logs" ("action_type")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_entity_type" ON "audit_logs" ("entity_type")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_project_id" ON "audit_logs" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_task_id" ON "audit_logs" ("task_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_task_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_project_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_entity_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_action_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_actor_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_created_at"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_source_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_type_enum"`);
  }
}
