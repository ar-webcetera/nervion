import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRecurringCompletionFixedRevenues1785250000000 implements MigrationInterface {
  name = 'RemoveRecurringCompletionFixedRevenues1785250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "fixed_revenues"
      WHERE "occurrence_date" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // Начисления от отметок выполнения повторяющихся задач больше не создаются.
  }
}
