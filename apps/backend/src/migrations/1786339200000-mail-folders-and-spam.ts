import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailFoldersAndSpam1786339200000 implements MigrationInterface {
  name = 'MailFoldersAndSpam1786339200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mail_folders" (
        "id" SERIAL NOT NULL,
        "account_id" integer NOT NULL,
        "name" character varying(80) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mail_folders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_mail_folders_account_id"
          FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_mail_folders_account_name"
      ON "mail_folders" ("account_id", LOWER("name"))
    `);
    await queryRunner.query(`
      CREATE TABLE "mail_spam_rules" (
        "id" SERIAL NOT NULL,
        "account_id" integer NOT NULL,
        "scope" character varying(16) NOT NULL,
        "value" character varying(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mail_spam_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_mail_spam_rules_account_id"
          FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_mail_spam_rules_account_scope_value"
      ON "mail_spam_rules" ("account_id", "scope", "value")
    `);
    await queryRunner.query(`ALTER TABLE "mail_threads" ADD "last_inbound_at" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "mail_threads" ADD "custom_folder_id" integer`);
    await queryRunner.query(`
      ALTER TABLE "mail_threads"
      ADD CONSTRAINT "FK_mail_threads_custom_folder_id"
      FOREIGN KEY ("custom_folder_id") REFERENCES "mail_folders"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`CREATE INDEX "IDX_mail_threads_custom_folder_id" ON "mail_threads" ("custom_folder_id")`);
    await queryRunner.query(`
      UPDATE "mail_threads" thread
      SET "last_inbound_at" = inbound."last_inbound_at"
      FROM (
        SELECT "thread_id", MAX("created_at") AS "last_inbound_at"
        FROM "mail_messages"
        WHERE "direction" = 'inbound' AND "deleted_at" IS NULL
        GROUP BY "thread_id"
      ) inbound
      WHERE inbound."thread_id" = thread."id"
    `);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD "is_spam" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD "spam_score" real NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD "spam_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "spam_reasons"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "spam_score"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "is_spam"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_threads_custom_folder_id"`);
    await queryRunner.query(`ALTER TABLE "mail_threads" DROP CONSTRAINT "FK_mail_threads_custom_folder_id"`);
    await queryRunner.query(`ALTER TABLE "mail_threads" DROP COLUMN "custom_folder_id"`);
    await queryRunner.query(`ALTER TABLE "mail_threads" DROP COLUMN "last_inbound_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_folders_account_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_spam_rules_account_scope_value"`);
    await queryRunner.query(`DROP TABLE "mail_spam_rules"`);
    await queryRunner.query(`DROP TABLE "mail_folders"`);
  }
}
