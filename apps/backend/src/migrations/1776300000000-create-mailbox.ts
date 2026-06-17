import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMailbox1776300000000 implements MigrationInterface {
  name = 'CreateMailbox1776300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "mail_account_type_enum" AS ENUM ('personal', 'service');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "mail_direction_enum" AS ENUM ('inbound', 'outbound');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "mail_message_status_enum" AS ENUM ('received', 'sent', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_accounts (
        id             SERIAL PRIMARY KEY,
        address        VARCHAR(255) NOT NULL UNIQUE,
        display_name   VARCHAR(255),
        type           "mail_account_type_enum" NOT NULL DEFAULT 'service',
        user_id        INT REFERENCES users(id) ON DELETE SET NULL,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        signature_html TEXT,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_threads (
        id                    SERIAL PRIMARY KEY,
        subject               VARCHAR(998) NOT NULL,
        account_id            INT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
        task_id               INT REFERENCES tasks(id) ON DELETE SET NULL,
        project_id            INT,
        counterparty_address  VARCHAR(255),
        last_message_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_threads_account ON mail_threads(account_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_threads_task ON mail_threads(task_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_threads_last_message ON mail_threads(last_message_at DESC)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_messages (
        id                 SERIAL PRIMARY KEY,
        thread_id          INT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
        direction          "mail_direction_enum" NOT NULL,
        message_id         VARCHAR(998),
        in_reply_to        VARCHAR(998),
        references_header  TEXT,
        from_address       VARCHAR(255) NOT NULL,
        from_name          VARCHAR(255),
        to_addresses       JSONB NOT NULL DEFAULT '[]',
        cc_addresses       JSONB NOT NULL DEFAULT '[]',
        subject            VARCHAR(998),
        text_body          TEXT,
        html_body          TEXT,
        raw_s3_key         VARCHAR(1024),
        auth_results       JSONB,
        is_read            BOOLEAN NOT NULL DEFAULT FALSE,
        status             "mail_message_status_enum" NOT NULL DEFAULT 'received',
        sent_by_user_id    INT REFERENCES users(id),
        created_at         TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_messages_message_id ON mail_messages(message_id)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_mail_messages_unread ON mail_messages(thread_id) WHERE is_read = FALSE AND direction = 'inbound'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_attachments (
        id            SERIAL PRIMARY KEY,
        message_id    INT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
        filename      VARCHAR(512) NOT NULL,
        content_type  VARCHAR(255) NOT NULL,
        size          INT NOT NULL,
        s3_key        VARCHAR(1024) NOT NULL,
        content_id    VARCHAR(255),
        is_inline     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mail_attachments_message ON mail_attachments(message_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS mail_attachments`);
    await queryRunner.query(`DROP TABLE IF EXISTS mail_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS mail_threads`);
    await queryRunner.query(`DROP TABLE IF EXISTS mail_accounts`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mail_message_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mail_direction_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mail_account_type_enum"`);
  }
}
