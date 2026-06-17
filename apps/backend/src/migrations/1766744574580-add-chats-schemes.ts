import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatsSchemes1766744574580 implements MigrationInterface {
  name = 'AddChatsSchemes1766744574580';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sender_id" uuid, "message" jsonb, "is_edited" boolean NOT NULL DEFAULT false, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "reply_to_id" uuid, "edited_at" TIMESTAMP WITH TIME ZONE, "chat_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_chat_messages_reply_to" ON "chat_messages" ("reply_to_id") `);
    await queryRunner.query(`CREATE INDEX "idx_chat_messages_sender" ON "chat_messages" ("sender_id") `);
    await queryRunner.query(`CREATE INDEX "idx_chat_messages_chat_created" ON "chat_messages" ("chat_id", "created_at") `);
    await queryRunner.query(
      `CREATE TABLE "chat_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chat_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(16) NOT NULL DEFAULT 'member', "left_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_chat_member" UNIQUE ("chat_id", "user_id"), CONSTRAINT "PK_aea646f59c92c47af5804ce73a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_chat_members_user" ON "chat_members" ("user_id") `);
    await queryRunner.query(`CREATE INDEX "idx_chat_members_chat" ON "chat_members" ("chat_id") `);
    await queryRunner.query(`CREATE TYPE "public"."chats_type_enum" AS ENUM('direct', 'group')`);
    await queryRunner.query(
      `CREATE TABLE "chats" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."chats_type_enum" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_message_reads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_message_user_read" UNIQUE ("message_id", "user_id"), CONSTRAINT "PK_be708581c7ff620908217ff381a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_reads_message" ON "chat_message_reads" ("message_id") `);
    await queryRunner.query(`CREATE INDEX "idx_reads_user" ON "chat_message_reads" ("user_id") `);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1766744575780'`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_9f5c0b96255734666b7b4bc98c3" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_members" ADD CONSTRAINT "FK_29ffb4b6edf59a7862129765339" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_members" DROP CONSTRAINT "FK_29ffb4b6edf59a7862129765339"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_9f5c0b96255734666b7b4bc98c3"`);
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum_old" AS ENUM('admin', 'employee', 'guest')`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'employee'`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`);
    await queryRunner.query(`ALTER TABLE "timelogs" ALTER COLUMN "change_status_at" SET DEFAULT '1765586504712'`);
    await queryRunner.query(`DROP INDEX "public"."idx_reads_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_reads_message"`);
    await queryRunner.query(`DROP TABLE "chat_message_reads"`);
    await queryRunner.query(`DROP TABLE "chats"`);
    await queryRunner.query(`DROP TYPE "public"."chats_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chat_members_chat"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chat_members_user"`);
    await queryRunner.query(`DROP TABLE "chat_members"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chat_messages_chat_created"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chat_messages_sender"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chat_messages_reply_to"`);
    await queryRunner.query(`DROP TABLE "chat_messages"`);
  }
}
