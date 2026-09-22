import { MigrationInterface, QueryRunner } from 'typeorm';

export class SelectedMailAccount1790096400000 implements MigrationInterface {
  name = 'SelectedMailAccount1790096400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "selected_mail_account_id" integer`);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_selected_mail_account"
      FOREIGN KEY ("selected_mail_account_id") REFERENCES "mail_accounts"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_selected_mail_account"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "selected_mail_account_id"`);
  }
}
