import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddYandexIdToUsers1776900000000 implements MigrationInterface {
  name = 'AddYandexIdToUsers1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) {
      return;
    }

    const hasColumn = await queryRunner.hasColumn('users', 'yandex_id');
    if (!hasColumn) {
      await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "yandex_id" character varying`);
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_yandex_id" ON "users" ("yandex_id") WHERE "yandex_id" IS NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) {
      return;
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_yandex_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "yandex_id"`);
  }
}
