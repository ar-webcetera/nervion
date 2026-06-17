import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelateTasks1765586502031 implements MigrationInterface {
  name = 'RelateTasks1765586502031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "task_relations" ("task_id" integer NOT NULL, "related_task_id" integer NOT NULL, CONSTRAINT "PK_4552beefab30659efea0f914d5a" PRIMARY KEY ("task_id", "related_task_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_48d69ec95ce2f5cc8cd684b982" ON "task_relations" ("task_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_8df3e3f103114f679df8bc263d" ON "task_relations" ("related_task_id") `);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1765586504712'`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "taskType"`);
    await queryRunner.query(`CREATE TYPE "public"."tasks_tasktype_enum" AS ENUM('user-story', 'task')`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "taskType" "public"."tasks_tasktype_enum" NOT NULL DEFAULT 'task'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
    await queryRunner.query(
      `ALTER TABLE "task_relations" ADD CONSTRAINT "FK_48d69ec95ce2f5cc8cd684b982f" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_relations" ADD CONSTRAINT "FK_8df3e3f103114f679df8bc263d7" FOREIGN KEY ("related_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "task_relations" DROP CONSTRAINT "FK_8df3e3f103114f679df8bc263d7"`);
    await queryRunner.query(`ALTER TABLE "task_relations" DROP CONSTRAINT "FK_48d69ec95ce2f5cc8cd684b982f"`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum_old" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "taskType"`);
    await queryRunner.query(`DROP TYPE "public"."tasks_tasktype_enum"`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "taskType" character varying NOT NULL DEFAULT 'task'`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1763220175585'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8df3e3f103114f679df8bc263d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_48d69ec95ce2f5cc8cd684b982"`);
    await queryRunner.query(`DROP TABLE "task_relations"`);
  }
}
