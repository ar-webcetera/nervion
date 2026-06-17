import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddKanbanPrefsToUserTaskFilters1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'user_task_filters',
      new TableColumn({
        name: 'collapsed_columns',
        type: 'jsonb',
        isNullable: false,
        default: "'[]'",
        comment: 'Статусы свёрнутых колонок Kanban (per-user)',
      }),
    );

    await queryRunner.addColumn(
      'user_task_filters',
      new TableColumn({
        name: 'view_type',
        type: 'varchar',
        isNullable: false,
        default: "'list'",
        comment: 'Выбранный режим отображения задач: kanban | list | weekly (per-user)',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user_task_filters', 'view_type');
    await queryRunner.dropColumn('user_task_filters', 'collapsed_columns');
  }
}
