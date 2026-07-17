import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMailboxFolders1776400000000 implements MigrationInterface {
  name = 'AddMailboxFolders1776400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasThreads = await queryRunner.hasTable('mail_threads');
    if (!hasThreads) {
      return;
    }

    const hasFolder = await queryRunner.hasColumn('mail_threads', 'folder');
    if (!hasFolder) {
      await queryRunner.query(`ALTER TABLE "mail_threads" ADD COLUMN "folder" VARCHAR(16) NOT NULL DEFAULT 'inbox'`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_threads_folder ON mail_threads(folder)`);
    }

    const hasDeletedAt = await queryRunner.hasColumn('mail_messages', 'deleted_at');
    if (!hasDeletedAt) {
      await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN "deleted_at" TIMESTAMP`);
    }

    await queryRunner.query(`ALTER TYPE "mail_message_status_enum" ADD VALUE IF NOT EXISTS 'draft'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasThreads = await queryRunner.hasTable('mail_threads');
    if (!hasThreads) {
      return;
    }

    await queryRunner.query(`DROP INDEX IF EXISTS idx_mail_threads_folder`);
    await queryRunner.query(`ALTER TABLE "mail_threads" DROP COLUMN IF EXISTS "folder"`);
    await queryRunner.query(`ALTER TABLE "mail_messages" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
