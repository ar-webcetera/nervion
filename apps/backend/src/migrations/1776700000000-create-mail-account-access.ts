import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMailAccountAccess1776700000000 implements MigrationInterface {
  name = 'CreateMailAccountAccess1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_account_access (
        mail_account_id INT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
        user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (mail_account_id, user_id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_account_access_user ON mail_account_access(user_id)`);

    await queryRunner.query(`
      INSERT INTO mail_account_access (mail_account_id, user_id)
        SELECT a.id, a.user_id
          FROM mail_accounts a
         WHERE a.type = 'personal' AND a.user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO mail_account_access (mail_account_id, user_id)
        SELECT a.id, u.id
          FROM mail_accounts a
          CROSS JOIN users u
         WHERE a.type = 'service'
           AND u.role IN ('admin', 'employee')
           AND u.deleted_at IS NULL
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mail_account_access_user`);
    await queryRunner.query(`DROP TABLE IF EXISTS mail_account_access`);
  }
}
