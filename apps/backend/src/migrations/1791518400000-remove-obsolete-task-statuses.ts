import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveObsoleteTaskStatuses1791518400000 implements MigrationInterface {
  name = 'RemoveObsoleteTaskStatuses1791518400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tasks"
      SET "status" = 'in_review'
      WHERE "status" IN ('testing', 'ready_for_release', 'prod_check')
    `);
    await queryRunner.query(`
      UPDATE "user_task_filters"
      SET
        "task_filters" = jsonb_set(
          jsonb_set(
            "task_filters",
            '{statuses}',
            COALESCE(
              (
                SELECT jsonb_agg(item.value)
                FROM jsonb_array_elements_text(COALESCE("task_filters"->'statuses', '[]'::jsonb)) AS item(value)
                WHERE item.value NOT IN ('testing', 'ready_for_release', 'prod_check')
              ),
              '[]'::jsonb
            ),
            true
          ),
          '{negativeFilters}',
          COALESCE("task_filters"->'negativeFilters', '{}'::jsonb)
            - 'status-testing'
            - 'status-ready_for_release'
            - 'status-prod_check',
          true
        ),
        "collapsed_columns" = COALESCE(
          (
            SELECT jsonb_agg(item.value)
            FROM jsonb_array_elements_text(COALESCE("collapsed_columns", '[]'::jsonb)) AS item(value)
            WHERE item.value NOT IN ('testing', 'ready_for_release', 'prod_check')
          ),
          '[]'::jsonb
        )
    `);
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" RENAME TO "tasks_status_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_status_enum" AS ENUM(
        'archive',
        'open',
        'to_do',
        'in_progress',
        'in_review',
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "public"."tasks_status_enum" RENAME TO "tasks_status_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_status_enum" AS ENUM(
        'archive',
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
