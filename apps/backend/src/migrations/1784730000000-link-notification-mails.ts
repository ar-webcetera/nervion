import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkNotificationMails1784730000000 implements MigrationInterface {
  name = 'LinkNotificationMails1784730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD "notification_id" integer`);
    await queryRunner.query(`CREATE INDEX "IDX_mail_messages_notification_id" ON "mail_messages" ("notification_id")`);
    await queryRunner.query(`
      ALTER TABLE "mail_messages"
      ADD CONSTRAINT "FK_mail_messages_notification_id"
      FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_mail_messages_notification_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_mail_messages_notification_id"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN "notification_id"`);
  }
}
