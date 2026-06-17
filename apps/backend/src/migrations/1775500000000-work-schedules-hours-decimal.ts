import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkSchedulesHoursDecimal1775500000000 implements MigrationInterface {
  name = 'WorkSchedulesHoursDecimal1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "work_schedules"
        ALTER COLUMN "hours" TYPE decimal(5,2)
        USING "hours"::decimal(5,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "work_schedules"
        ALTER COLUMN "hours" TYPE integer
        USING round("hours")::integer
    `);
  }
}
