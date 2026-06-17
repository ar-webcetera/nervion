import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHealthchecks1775000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "healthchecks" (
        "id" SERIAL NOT NULL,
        "name" character varying(255) NOT NULL,
        "url" character varying(1000) NOT NULL,
        "interval_seconds" integer NOT NULL DEFAULT 60,
        "timeout_seconds" integer NOT NULL DEFAULT 10,
        "expected_status" integer NOT NULL DEFAULT 200,
        "chat_id" character varying(36) NOT NULL,
        "sender_user_id" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_status" character varying(20) NOT NULL DEFAULT 'unknown',
        "last_checked_at" TIMESTAMP,
        "last_error" character varying(500),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_healthchecks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_healthchecks_sender_user" FOREIGN KEY ("sender_user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "healthchecks"`);
  }
}
