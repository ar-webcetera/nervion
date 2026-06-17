import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApiTokens1769000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_tokens" (
        "id" SERIAL NOT NULL,
        "name" character varying(255) NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "user_id" integer NOT NULL,
        "last_used_at" TIMESTAMP,
        "expires_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_api_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "PK_api_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_api_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "api_tokens"`);
  }
}
