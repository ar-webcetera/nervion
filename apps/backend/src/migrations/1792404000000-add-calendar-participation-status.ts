import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarParticipationStatus1792404000000 implements MigrationInterface {
  name = 'AddCalendarParticipationStatus1792404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "calendar_participation_status_enum" AS ENUM ('invited', 'accepted')`);
    await queryRunner.query(`
      ALTER TABLE "calendar_event_participants"
      ADD "participation_status" "calendar_participation_status_enum" NOT NULL DEFAULT 'accepted',
      ADD "responded_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`UPDATE "calendar_event_participants" SET "responded_at" = now()`);
    await queryRunner.query(`
      ALTER TABLE "calendar_event_participants"
      ALTER COLUMN "participation_status" SET DEFAULT 'invited'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "calendar_event_participants"
      DROP COLUMN "responded_at",
      DROP COLUMN "participation_status"
    `);
    await queryRunner.query(`DROP TYPE "calendar_participation_status_enum"`);
  }
}
