import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRecurrenceSince1775400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tasks',
      new TableColumn({
        name: 'recurrence_since',
        type: 'date',
        isNullable: true,
        default: null,
        comment: 'Дата с которой начинаются повторения задачи',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tasks', 'recurrence_since');
  }
}
