import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRevenueTracking1785162900000 implements MigrationInterface {
  name = 'AddRevenueTracking1785162900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."tasks_billing_type_enum" AS ENUM('hourly', 'fixed')`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "billing_type" "public"."tasks_billing_type_enum"`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "fixed_price" numeric(12,2)`);
    await queryRunner.query(`CREATE TYPE "public"."billing_review_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD "billing_status" "public"."billing_review_status_enum"`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD "billing_rate" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD "recognized_at" date`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD "reviewed_by_id" integer`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD "reviewed_at" TIMESTAMP`);
    await queryRunner.query(`
      CREATE TABLE "fixed_revenues" (
        "id" SERIAL NOT NULL,
        "task_id" integer NOT NULL,
        "project_id" integer,
        "occurrence_date" date,
        "amount" numeric(12,2) NOT NULL,
        "closed_at" TIMESTAMP NOT NULL,
        "recognized_at" date NOT NULL,
        "status" "public"."billing_review_status_enum" NOT NULL DEFAULT 'pending',
        "reviewed_by_id" integer,
        "reviewed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_fixed_revenue_task_occurrence" UNIQUE ("task_id", "occurrence_date"),
        CONSTRAINT "PK_fixed_revenues" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_revenue_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_revenue_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fixed_revenue_regular_task" ON "fixed_revenues" ("task_id") WHERE "occurrence_date" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "monthly_revenue_targets" (
        "id" SERIAL NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "amount" numeric(12,2) NOT NULL DEFAULT 0,
        "updated_by_id" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_monthly_revenue_target" UNIQUE ("year", "month"),
        CONSTRAINT "PK_monthly_revenue_targets" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "monthly_revenue_targets"`);
    await queryRunner.query(`DROP INDEX "IDX_fixed_revenue_regular_task"`);
    await queryRunner.query(`DROP TABLE "fixed_revenues"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN "reviewed_at"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN "reviewed_by_id"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN "recognized_at"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN "billing_rate"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN "billing_status"`);
    await queryRunner.query(`DROP TYPE "public"."billing_review_status_enum"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "fixed_price"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "billing_type"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_billing_type_enum"`);
  }
}
