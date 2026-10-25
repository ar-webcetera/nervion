import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskFlags1792630800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tasks ADD COLUMN is_flagged boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE tasks ADD COLUMN flag_comment varchar(500)`);
    await q.query(`ALTER TYPE "public"."audit_logs_action_type_enum" ADD VALUE IF NOT EXISTS 'tasks.flag_added'`);
    await q.query(`ALTER TYPE "public"."audit_logs_action_type_enum" ADD VALUE IF NOT EXISTS 'tasks.flag_removed'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tasks DROP COLUMN flag_comment`);
    await q.query(`ALTER TABLE tasks DROP COLUMN is_flagged`);
  }
}
