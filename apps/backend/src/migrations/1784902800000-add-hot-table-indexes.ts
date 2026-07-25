import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHotTableIndexes1784902800000 implements MigrationInterface {
  name = 'AddHotTableIndexes1784902800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_read_created"
      ON "notifications" ("recipient_id", "is_read", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_comments_task_id"
      ON "comments" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_comments_comment_id"
      ON "comments" ("comment_id")
      WHERE "comment_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_timelogs_author_status"
      ON "timelogs" ("author_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_timelogs_task_id"
      ON "timelogs" ("task_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_timelogs_task_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_timelogs_author_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_comments_comment_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_comments_task_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_recipient_read_created"`);
  }
}
