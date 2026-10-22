import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEditableTaskStages1792627200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE task_stages (id varchar PRIMARY KEY, title varchar(80) NOT NULL, position integer NOT NULL, protected boolean NOT NULL DEFAULT false)`,
    );
    await q.query(`CREATE UNIQUE INDEX task_stages_title_unique ON task_stages (lower(title))`);
    await q.query(`INSERT INTO task_stages (id, title, position, protected) VALUES
      ('archive', 'Архив', 0, false), ('open', 'Открыто', 1, true),
      ('to_do', 'К выполнению', 2, false), ('in_progress', 'Выполняется', 3, true),
      ('waiting', 'Ожидание', 4, false), ('in_review', 'На ревью', 5, false),
      ('control', 'Контроль', 6, false), ('closed', 'Закрыто', 7, true)`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status TYPE varchar USING status::text`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'open'`);
    // Sales retains its independent fixed workflow even if a production stage is removed.
    await q.query(`CREATE FUNCTION validate_task_stage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.business_kind = 'production' THEN
          PERFORM id FROM task_stages WHERE id = NEW.status FOR KEY SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Этап задачи удалён. Обновите доску.' USING ERRCODE = '23503'; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER task_stage_exists BEFORE INSERT OR UPDATE OF status, business_kind ON tasks FOR EACH ROW EXECUTE FUNCTION validate_task_stage()`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Refuse rollback while custom stages are in use instead of discarding task state.
    await q.query(`DROP TRIGGER task_stage_exists ON tasks`);
    await q.query(`DROP FUNCTION validate_task_stage()`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status TYPE tasks_status_enum USING status::tasks_status_enum`);
    await q.query(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'open'`);
    await q.query(`DROP TABLE task_stages`);
  }
}
