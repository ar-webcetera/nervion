import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmUserPreferences1790502000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE crm_user_preferences (
        user_id int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        collapsed_stage_ids int[] NOT NULL DEFAULT ARRAY[7, 8]
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE crm_user_preferences');
  }
}
