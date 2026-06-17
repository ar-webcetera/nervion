import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddClosedDateToTasks1772887320000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tasks',
      new TableColumn({
        name: 'closed_date',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tasks', 'closed_date');
  }
}
