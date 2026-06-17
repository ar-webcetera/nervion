import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkSchedules1775200000000 implements MigrationInterface {
  name = 'CreateWorkSchedules1775200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Таблица уже существовала со старой схемой (day_of_week, is_active).
    // Приводим к новой схеме через ALTER.
    const tableExists = await queryRunner.hasTable('work_schedules');

    if (!tableExists) {
      await queryRunner.query(`
        CREATE TABLE "work_schedules" (
          "id" SERIAL NOT NULL,
          "user_id" integer NOT NULL,
          "work_date" date NOT NULL,
          "start_time" TIME,
          "end_time" TIME,
          "hours" integer NOT NULL DEFAULT 0,
          "is_day_off" boolean NOT NULL DEFAULT false,
          "notes" text,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_work_schedules" PRIMARY KEY ("id")
        )
      `);
      await queryRunner.query(`
        ALTER TABLE "work_schedules"
          ADD CONSTRAINT "FK_work_schedules_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      `);
      return;
    }

    // Старая таблица — мигрируем колонки
    const hasWorkDate = await queryRunner.hasColumn('work_schedules', 'work_date');
    const hasDayOfWeek = await queryRunner.hasColumn('work_schedules', 'day_of_week');
    const hasIsActive = await queryRunner.hasColumn('work_schedules', 'is_active');
    const hasHours = await queryRunner.hasColumn('work_schedules', 'hours');
    const hasIsDayOff = await queryRunner.hasColumn('work_schedules', 'is_day_off');
    const hasNotes = await queryRunner.hasColumn('work_schedules', 'notes');

    if (hasDayOfWeek && !hasWorkDate) {
      // Очищаем старые данные и меняем колонку
      await queryRunner.query(`DELETE FROM "work_schedules"`);
      await queryRunner.query(`ALTER TABLE "work_schedules" DROP COLUMN "day_of_week"`);
      await queryRunner.query(`ALTER TABLE "work_schedules" ADD COLUMN "work_date" date NOT NULL DEFAULT CURRENT_DATE`);
      await queryRunner.query(`ALTER TABLE "work_schedules" ALTER COLUMN "work_date" DROP DEFAULT`);
    }

    // start_time / end_time — сделать nullable
    await queryRunner.query(`ALTER TABLE "work_schedules" ALTER COLUMN "start_time" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "work_schedules" ALTER COLUMN "end_time"   DROP NOT NULL`);

    if (!hasHours) {
      await queryRunner.query(`ALTER TABLE "work_schedules" ADD COLUMN "hours" integer NOT NULL DEFAULT 0`);
    }

    if (hasIsActive && !hasIsDayOff) {
      await queryRunner.query(`ALTER TABLE "work_schedules" RENAME COLUMN "is_active" TO "is_day_off"`);
      await queryRunner.query(`ALTER TABLE "work_schedules" ALTER COLUMN "is_day_off" SET DEFAULT false`);
    } else if (!hasIsDayOff) {
      await queryRunner.query(`ALTER TABLE "work_schedules" ADD COLUMN "is_day_off" boolean NOT NULL DEFAULT false`);
    }

    if (!hasNotes) {
      await queryRunner.query(`ALTER TABLE "work_schedules" ADD COLUMN "notes" text`);
    }

    // FK уже существует как FK_work_schedules_user — ничего не делаем
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "work_schedules"`);
  }
}
