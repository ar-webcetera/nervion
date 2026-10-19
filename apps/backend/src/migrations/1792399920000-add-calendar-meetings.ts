import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarMeetings1792399920000 implements MigrationInterface {
  name = 'AddCalendarMeetings1792399920000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "calendar_events" (
        "id" SERIAL NOT NULL,
        "title" character varying(200) NOT NULL,
        "notes" text,
        "start_at" TIMESTAMPTZ NOT NULL,
        "end_at" TIMESTAMPTZ NOT NULL,
        "timezone" character varying(100) NOT NULL DEFAULT 'Europe/Moscow',
        "reminder_minutes" integer NOT NULL DEFAULT 15,
        "creator_id" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_calendar_events_time" CHECK ("end_at" > "start_at"),
        CONSTRAINT "CHK_calendar_events_reminder" CHECK ("reminder_minutes" >= 0 AND "reminder_minutes" <= 10080),
        CONSTRAINT "PK_calendar_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_calendar_events_creator" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_calendar_events_range" ON "calendar_events" ("start_at", "end_at")`);

    await queryRunner.query(`
      CREATE TABLE "calendar_event_participants" (
        "event_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        CONSTRAINT "PK_calendar_event_participants" PRIMARY KEY ("event_id", "user_id"),
        CONSTRAINT "FK_calendar_participants_event" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_participants_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_calendar_participants_user" ON "calendar_event_participants" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "calendar_event_reminders" (
        "id" SERIAL NOT NULL,
        "event_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "remind_at" TIMESTAMPTZ NOT NULL,
        "sent_at" TIMESTAMPTZ,
        "processing_at" TIMESTAMPTZ,
        "attempts" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_calendar_event_reminders" PRIMARY KEY ("id"),
        CONSTRAINT "uq_calendar_reminder_event_user" UNIQUE ("event_id", "user_id"),
        CONSTRAINT "FK_calendar_reminders_event" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_reminders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_calendar_reminders_due" ON "calendar_event_reminders" ("remind_at") WHERE "sent_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "calendar_event_reminders"`);
    await queryRunner.query(`DROP TABLE "calendar_event_participants"`);
    await queryRunner.query(`DROP TABLE "calendar_events"`);
  }
}
