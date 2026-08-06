import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApproveLegacyTimelogs1785166500000 implements MigrationInterface {
  name = 'ApproveLegacyTimelogs1785166500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "timelogs" AS "timelog"
      SET
        "billing_status" = 'approved',
        "billing_rate" = COALESCE("project"."hourlyRate", 0),
        "recognized_at" = COALESCE("timelog"."tracking_date", "timelog"."updated_at"::date),
        "reviewed_at" = now()
      FROM "tasks" AS "task"
      LEFT JOIN "projects" AS "project" ON "project"."id" = "task"."project_id"
      WHERE
        "task"."id" = "timelog"."task_id"
        AND "timelog"."status" = 'completed'
        AND COALESCE("timelog"."tracking_date", "timelog"."updated_at"::date) <= DATE '2026-06-30'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "timelogs"
      SET
        "billing_status" = NULL,
        "billing_rate" = NULL,
        "recognized_at" = NULL,
        "reviewed_at" = NULL
      WHERE
        "status" = 'completed'
        AND COALESCE("tracking_date", "updated_at"::date) <= DATE '2026-06-30'
    `);
  }
}
