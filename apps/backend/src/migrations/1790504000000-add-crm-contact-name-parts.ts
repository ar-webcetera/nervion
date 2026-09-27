import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmContactNameParts1790504000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE crm_contacts
        ADD COLUMN last_name varchar(200) NOT NULL DEFAULT '',
        ADD COLUMN patronymic varchar(200) NOT NULL DEFAULT '';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE crm_contacts
        DROP COLUMN patronymic,
        DROP COLUMN last_name;
    `);
  }
}
