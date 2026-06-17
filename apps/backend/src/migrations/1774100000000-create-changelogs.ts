import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateChangelogs1774100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'changelogs',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'body', type: 'jsonb', isNullable: true },
          { name: 'is_published', type: 'boolean', default: false },
          { name: 'author_id', type: 'int', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
    );

    await queryRunner.createForeignKey(
      'changelogs',
      new TableForeignKey({
        columnNames: ['author_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'changelog_views',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'user_id', type: 'int' },
          { name: 'changelog_id', type: 'int' },
          { name: 'viewed_at', type: 'timestamp', default: 'now()' },
        ],
      }),
    );

    await queryRunner.createForeignKey(
      'changelog_views',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'changelog_views',
      new TableForeignKey({
        columnNames: ['changelog_id'],
        referencedTableName: 'changelogs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('changelog_views', true);
    await queryRunner.dropTable('changelogs', true);
  }
}
