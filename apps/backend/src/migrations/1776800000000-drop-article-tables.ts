import { MigrationInterface, QueryRunner } from 'typeorm';

// Блог (статьи/категории) вынесен из трекера в отдельный бэкенд сайта.
// Окончательно удаляем осиротевшие таблицы блога из БД трекера.
export class DropArticleTables1776800000000 implements MigrationInterface {
  name = 'DropArticleTables1776800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS article_views CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS article_blocks CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS articles CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS article_categories CASCADE`);
  }

  public async down(): Promise<void> {
    // Откат не предусмотрен: блог живёт в отдельной БД сайта (webcetera_blog).
  }
}
