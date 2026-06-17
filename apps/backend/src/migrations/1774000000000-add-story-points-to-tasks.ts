import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddStoryPointsToTasks1774000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tasks',
      new TableColumn({
        name: 'story_points',
        type: 'int',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tasks', 'story_points');
  }
}
