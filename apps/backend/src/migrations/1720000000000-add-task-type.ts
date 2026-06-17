import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefaultTaskType1720000000000 implements MigrationInterface {
  name = 'AddDefaultTaskType1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "taskType" varchar;
    `);

    await queryRunner.query(`
      UPDATE "tasks"
      SET "taskType" = 'task'
      WHERE "taskType" IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
      ALTER COLUMN "taskType" SET DEFAULT 'task';
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
      ALTER COLUMN "taskType" SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ALTER COLUMN "taskType" DROP NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
      ALTER COLUMN "taskType" DROP DEFAULT;
    `);
  }
}
