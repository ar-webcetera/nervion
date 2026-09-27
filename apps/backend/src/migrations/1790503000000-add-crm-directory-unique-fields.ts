import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmDirectoryUniqueFields1790503000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX crm_companies_name_unique_idx
        ON crm_companies (LOWER(BTRIM(name)));
      CREATE UNIQUE INDEX crm_contacts_phone_unique_idx
        ON crm_contacts (REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
        WHERE REGEXP_REPLACE(phone, '[^0-9]', '', 'g') <> '';
      CREATE UNIQUE INDEX crm_contacts_email_unique_idx
        ON crm_contacts (LOWER(BTRIM(email)))
        WHERE BTRIM(email) <> '';
      CREATE UNIQUE INDEX crm_contacts_telegram_unique_idx
        ON crm_contacts (LOWER(REGEXP_REPLACE(BTRIM(telegram), '^@+', '')))
        WHERE REGEXP_REPLACE(BTRIM(telegram), '^@+', '') <> '';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX crm_contacts_telegram_unique_idx;
      DROP INDEX crm_contacts_email_unique_idx;
      DROP INDEX crm_contacts_phone_unique_idx;
      DROP INDEX crm_companies_name_unique_idx;
    `);
  }
}
