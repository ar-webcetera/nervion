import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateAllocationsTable1738390000000 implements MigrationInterface {
  name = 'CreateAllocationsTable1738390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'allocations',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'user_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'project_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'start_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'end_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'start_time',
            type: 'time',
            isNullable: true,
          },
          {
            name: 'end_time',
            type: 'time',
            isNullable: true,
          },
          {
            name: 'hours',
            type: 'int',
            default: 8,
            isNullable: false,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'allocations',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'allocations',
      new TableForeignKey({
        columnNames: ['project_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'projects',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('allocations');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('allocations', foreignKey);
      }
    }
    await queryRunner.dropTable('allocations');
  }
}
