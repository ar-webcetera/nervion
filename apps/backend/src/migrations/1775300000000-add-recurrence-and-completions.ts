import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddRecurrenceAndCompletions1775300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tasks',
      new TableColumn({
        name: 'recurrence_days',
        type: 'int',
        isArray: true,
        isNullable: true,
        default: null,
        comment: 'Дни недели повторения: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'task_completions',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'task_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'completed_at',
            type: 'date',
            isNullable: false,
            comment: 'Дата выполнения (без времени)',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'task_completions',
      new TableForeignKey({
        columnNames: ['task_id'],
        referencedTableName: 'tasks',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'task_completions',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'task_completions',
      new TableIndex({
        name: 'IDX_task_completions_task_date',
        columnNames: ['task_id', 'completed_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('task_completions', true);
    await queryRunner.dropColumn('tasks', 'recurrence_days');
  }
}
