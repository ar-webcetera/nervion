import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameNewLeadStage1790501000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE crm_stages
      SET name = 'Неразобранное'
      WHERE position = 1 AND kind = 'open' AND name = 'Новая заявка'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE crm_stages
      SET name = 'Новая заявка'
      WHERE position = 1 AND kind = 'open' AND name = 'Неразобранное'
    `);
  }
}
