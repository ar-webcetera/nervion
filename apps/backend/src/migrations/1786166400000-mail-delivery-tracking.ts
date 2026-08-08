import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailDeliveryTracking1786166400000 implements MigrationInterface {
  name = 'MailDeliveryTracking1786166400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "provider_message_id" character varying(255)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mail_messages_provider_message_id"
      ON "mail_messages" ("provider_message_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "delivery_status" character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "first_opened_at" TIMESTAMP
    `);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "open_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "click_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD "last_delivery_event_at" TIMESTAMP
    `);
    await queryRunner.query(`
      UPDATE "mail_messages"
      SET "delivery_status" = 'sent'
      WHERE "direction" = 'outbound' AND "status" = 'sent' AND "delivery_status" IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "mail_delivery_events" (
        "id" SERIAL NOT NULL,
        "message_id" integer NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "provider_event_id" character varying(255),
        "occurred_at" TIMESTAMP NOT NULL,
        "meta" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mail_delivery_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_mail_delivery_events_provider_event_id" UNIQUE ("provider_event_id"),
        CONSTRAINT "FK_mail_delivery_events_message_id"
          FOREIGN KEY ("message_id") REFERENCES "mail_messages"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_mail_delivery_events_message_id"
      ON "mail_delivery_events" ("message_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "mail_delivery_events"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "last_delivery_event_at"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "click_count"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "open_count"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "first_opened_at"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "delivery_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_messages_provider_message_id"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "provider_message_id"`);
  }
}
