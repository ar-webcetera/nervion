import { MigrationInterface, QueryRunner } from 'typeorm';

export class TimelogUnboundTracking1786252800000 implements MigrationInterface {
  name = 'TimelogUnboundTracking1786252800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "task_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "timelogs" ADD COLUMN IF NOT EXISTS "title" varchar NULL`);

    await queryRunner.query(`DROP INDEX IF EXISTS "unique_active_timelogs_per_task_author"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_timelogs_per_task_author"
      ON "timelogs" ("task_id", "author_id")
      WHERE "status" = 'in_progress' AND "task_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_unbound_timelog_per_author"
      ON "timelogs" ("author_id")
      WHERE "status" = 'in_progress' AND "task_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "unique_active_unbound_timelog_per_author"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "unique_active_timelogs_per_task_author"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_timelogs_per_task_author"
      ON "timelogs" ("task_id", "author_id")
      WHERE "status" IN ('in_progress')
    `);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP COLUMN IF EXISTS "title"`);
    // Записей без задачи в старой схеме быть не может, а FK на tasks не даст подставить заглушку
    await queryRunner.query(`DELETE FROM "timelogs" WHERE "task_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "task_id" SET NOT NULL`);
  }
}
