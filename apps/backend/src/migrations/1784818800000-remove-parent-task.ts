import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveParentTask1784818800000 implements MigrationInterface {
  name = 'RemoveParentTask1784818800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "task_relations" ("task_id", "related_task_id")
      SELECT "id", "parent_task_id"
      FROM "tasks"
      WHERE "parent_task_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "task_relations" ("task_id", "related_task_id")
      SELECT "parent_task_id", "id"
      FROM "tasks"
      WHERE "parent_task_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_54fc42a253a8338488ec1f960ad"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "parent_task_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "parent_task_id" integer`);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "FK_54fc42a253a8338488ec1f960ad"
      FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }
}
