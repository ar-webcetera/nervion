import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserHiddenMenuItems1776500000000 implements MigrationInterface {
  name = 'AddUserHiddenMenuItems1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) {
      return;
    }

    const hasColumn = await queryRunner.hasColumn('users', 'hidden_menu_items');
    if (!hasColumn) {
      await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "hidden_menu_items" JSONB NOT NULL DEFAULT '[]'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) {
      return;
    }
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "hidden_menu_items"`);
  }
}
