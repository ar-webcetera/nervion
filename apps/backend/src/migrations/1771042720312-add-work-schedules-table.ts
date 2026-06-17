import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkSchedulesTable1771042720312 implements MigrationInterface {
  name = 'AddWorkSchedulesTable1771042720312';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "timelogs" DROP CONSTRAINT "FK_4fee65b05008be16aa0c4335765"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP CONSTRAINT "FK_3f8d97321219ae2b341b724ee26"`);
    await queryRunner.query(
      `CREATE TABLE "allocations" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "project_id" integer NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "start_time" TIME, "end_time" TIME, "hours" integer NOT NULL DEFAULT '8', "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ca63099fc248466264af0fa6f1f" PRIMARY KEY ("id")); COMMENT ON COLUMN "allocations"."hours" IS 'Hours per day'`,
    );
    await queryRunner.query(`ALTER TABLE "projects" ADD "description" jsonb`);
    await queryRunner.query(`CREATE TYPE "public"."projects_status_enum" AS ENUM('in_progress', 'on_hold')`);
    await queryRunner.query(`ALTER TABLE "projects" ADD "status" "public"."projects_status_enum" NOT NULL DEFAULT 'in_progress'`);
    await queryRunner.query(`ALTER TABLE "projects" ADD "budget" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "projects" ADD "hourlyRate" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`DROP INDEX "public"."unique_active_timelogs_per_task_author"`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "task_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "author_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1771042721621'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
    await queryRunner.query(`ALTER TABLE "wiki_pages" DROP COLUMN "priority"`);
    await queryRunner.query(`ALTER TABLE "wiki_pages" ADD "priority" integer NOT NULL DEFAULT '100'`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_active_timelogs_per_task_author" ON "timelogs" ("task_id", "author_id") WHERE "status" IN ('in_progress')`,
    );
    await queryRunner.query(
      `ALTER TABLE "timelogs" ADD CONSTRAINT "FK_4fee65b05008be16aa0c4335765" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timelogs" ADD CONSTRAINT "FK_3f8d97321219ae2b341b724ee26" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "allocations" ADD CONSTRAINT "FK_28409a4ad876dc3ae8ce0a665bd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "allocations" ADD CONSTRAINT "FK_1e9073e8826a16fd21cbbece599" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "allocations" DROP CONSTRAINT "FK_1e9073e8826a16fd21cbbece599"`);
    await queryRunner.query(`ALTER TABLE "allocations" DROP CONSTRAINT "FK_28409a4ad876dc3ae8ce0a665bd"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP CONSTRAINT "FK_3f8d97321219ae2b341b724ee26"`);
    await queryRunner.query(`ALTER TABLE "timelogs" DROP CONSTRAINT "FK_4fee65b05008be16aa0c4335765"`);
    await queryRunner.query(`DROP INDEX "public"."unique_active_timelogs_per_task_author"`);
    await queryRunner.query(`ALTER TABLE "wiki_pages" DROP COLUMN "priority"`);
    await queryRunner.query(`ALTER TABLE "wiki_pages" ADD "priority" numeric NOT NULL DEFAULT '100'`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum_old" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1769481799920'`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "author_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "task_id" DROP NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_active_timelogs_per_task_author" ON "timelogs" ("author_id", "task_id") WHERE (status = 'in_progress'::timelogs_status_enum)`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "hourlyRate"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "budget"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "public"."projects_status_enum"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "description"`);
    await queryRunner.query(`DROP TABLE "allocations"`);
    await queryRunner.query(
      `ALTER TABLE "timelogs" ADD CONSTRAINT "FK_3f8d97321219ae2b341b724ee26" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timelogs" ADD CONSTRAINT "FK_4fee65b05008be16aa0c4335765" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
