import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRepos1776600000000 implements MigrationInterface {
  name = 'CreateRepos1776600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const has = await queryRunner.hasTable('repos');
    if (has) return;

    await queryRunner.query(`
      CREATE TABLE "repos" (
        "id" SERIAL NOT NULL,
        "project_id" integer,
        "name" character varying NOT NULL,
        "gitdir" text NOT NULL,
        "default_branch" character varying NOT NULL DEFAULT 'main',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_repos" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_repos_project_name" ON "repos" ("project_id", "name")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_repos_project_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repos"`);
  }
}
