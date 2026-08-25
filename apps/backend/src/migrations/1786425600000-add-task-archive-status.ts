import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskArchiveStatus1786425600000 implements MigrationInterface {
  name = 'AddTaskArchiveStatus1786425600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" ADD VALUE IF NOT EXISTS 'archive' BEFORE 'open'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "tasks" SET "status" = 'open' WHERE "status" = 'archive'`);
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" RENAME TO "tasks_status_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_status_enum" AS ENUM(
        'open',
        'to_do',
        'in_progress',
        'in_review',
        'testing',
        'ready_for_release',
        'prod_check',
        'control',
        'closed'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ALTER COLUMN "status" TYPE "public"."tasks_status_enum"
      USING "status"::text::"public"."tasks_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await queryRunner.query(`DROP TYPE "public"."tasks_status_enum_old"`);
  }
}
