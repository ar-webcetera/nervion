import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTrackingDateToTimelogs1775600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'timelogs',
      new TableColumn({
        name: 'tracking_date',
        type: 'date',
        isNullable: true,
        default: null,
        comment: 'Дата экземпляра повторяющейся задачи, для которого запущен таймер',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('timelogs', 'tracking_date');
  }
}
