import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyTaskDeadline1785076500000 implements MigrationInterface {
  name = 'RemoveLegacyTaskDeadline1785076500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "deadline_time_to"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "deadline_time_from"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "deadline_date"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "deadline_date" date`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "deadline_time_from" TIME`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "deadline_time_to" TIME`);
  }
}
