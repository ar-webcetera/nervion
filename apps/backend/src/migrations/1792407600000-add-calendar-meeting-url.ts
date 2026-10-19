import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarMeetingUrl1792407600000 implements MigrationInterface {
  name = 'AddCalendarMeetingUrl1792407600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD "meeting_url" character varying(2000)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN "meeting_url"`);
  }
}
