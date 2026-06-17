import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushSubscriptions1775100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE push_subscriptions (
        id         SERIAL PRIMARY KEY,
        user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS push_subscriptions;`);
  }
}
