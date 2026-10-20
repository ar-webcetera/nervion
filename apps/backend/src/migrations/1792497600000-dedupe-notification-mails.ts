import { MigrationInterface, QueryRunner } from 'typeorm';

export class DedupeNotificationMails1792497600000 implements MigrationInterface {
  name = 'DedupeNotificationMails1792497600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH duplicates AS (
        SELECT id, thread_id
        FROM (
          SELECT
            id,
            thread_id,
            ROW_NUMBER() OVER (
              PARTITION BY notification_id
              ORDER BY created_at ASC, id ASC
            ) AS position
          FROM mail_messages
          WHERE notification_id IS NOT NULL
        ) ranked
        WHERE ranked.position > 1
      )
      DELETE FROM mail_threads thread
      WHERE thread.id IN (
        SELECT duplicate.thread_id
        FROM duplicates duplicate
        WHERE (
          SELECT COUNT(*)
          FROM mail_messages message
          WHERE message.thread_id = duplicate.thread_id
        ) = 1
      )
    `);
    await queryRunner.query(`
      WITH duplicates AS (
        SELECT id
        FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY notification_id
              ORDER BY created_at ASC, id ASC
            ) AS position
          FROM mail_messages
          WHERE notification_id IS NOT NULL
        ) ranked
        WHERE ranked.position > 1
      )
      DELETE FROM mail_messages
      WHERE id IN (SELECT id FROM duplicates)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_mail_messages_notification_id"
      ON "mail_messages" ("notification_id")
      WHERE "notification_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_mail_messages_notification_id"`);
  }
}
