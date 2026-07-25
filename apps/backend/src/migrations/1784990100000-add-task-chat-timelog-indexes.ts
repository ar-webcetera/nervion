import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskChatTimelogIndexes1784990100000 implements MigrationInterface {
  name = 'AddTaskChatTimelogIndexes1784990100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_responsible_id"
      ON "tasks" ("responsible_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_status_priority"
      ON "tasks" ("status", "priority" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_project_id"
      ON "tasks" ("project_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_message_read_status_message_id"
      ON "chat_message_read_status" ("message_id")
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_timelogs_task_id"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_timelogs_task_created"
      ON "timelogs" ("task_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_timelogs_task_created"`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_timelogs_task_id"
      ON "timelogs" ("task_id")
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_message_read_status_message_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_project_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_status_priority"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_responsible_id"`);
  }
}
