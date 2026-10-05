import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrivateProjects1790505000000 implements MigrationInterface {
  name = 'AddPrivateProjects1790505000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ADD "is_private" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "projects" ADD "owner_id" integer`);
    await queryRunner.query(`CREATE INDEX "IDX_projects_private_owner" ON "projects" ("is_private", "owner_id")`);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "CHK_projects_private_owner" CHECK (NOT "is_private" OR "owner_id" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "FK_projects_owner"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "CHK_projects_private_owner"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_projects_private_owner"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "owner_id"`);
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "is_private"`);
  }
}
