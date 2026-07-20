import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_HEAD_MIGRATION = 'AddYandexIdToUsers1776900000000';

export class InitialSchema1784548639098 implements MigrationInterface {
  name = 'InitialSchema1784548639098';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('users')) {
      const legacyHead = await queryRunner.query('SELECT 1 FROM "migrations" WHERE "name" = $1 LIMIT 1', [LEGACY_HEAD_MIGRATION]);
      if (legacyHead.length > 0) return;

      throw new Error('Обнаружена неполная legacy-схема. Сначала примените все миграции версии 0.2.0, затем обновите Nervion.');
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
            CREATE TYPE "public"."projects_status_enum" AS ENUM('in_progress', 'on_hold')
        `);
    await queryRunner.query(`
            CREATE TABLE "projects" (
                "id" SERIAL NOT NULL,
                "name" character varying NOT NULL,
                "description" jsonb,
                "status" "public"."projects_status_enum" NOT NULL DEFAULT 'in_progress',
                "budget" integer NOT NULL DEFAULT '0',
                "hourlyRate" integer NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_2187088ab5ef2a918473cb99007" UNIQUE ("name"),
                CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "project_members" (
                "id" SERIAL NOT NULL,
                "role" character varying NOT NULL DEFAULT 'guest',
                "grade" character varying NOT NULL DEFAULT 'junior',
                "cost" integer NOT NULL DEFAULT '0',
                "user_id" integer,
                "project_id" integer,
                CONSTRAINT "UQ_b3f491d3a3f986106d281d8eb4b" UNIQUE ("user_id", "project_id"),
                CONSTRAINT "PK_0b2f46f804be4aea9234c78bcc9" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."timelogs_status_enum" AS ENUM('in_progress', 'paused', 'completed')
        `);
    await queryRunner.query(`
            CREATE TABLE "timelogs" (
                "id" SERIAL NOT NULL,
                "task_id" integer NOT NULL,
                "status" "public"."timelogs_status_enum" NOT NULL DEFAULT 'in_progress',
                "time_spent" numeric NOT NULL DEFAULT '0',
                "author_id" integer NOT NULL,
                "summary" character varying,
                "tracking_date" date,
                "change_status_at" bigint NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_48a0bf46c28e3518e03cf49c820" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "unique_active_timelogs_per_task_author" ON "timelogs" ("task_id", "author_id")
            WHERE "status" IN ('in_progress')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."tasks_tasktype_enum" AS ENUM('user-story', 'task')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."tasks_status_enum" AS ENUM(
                'open',
                'to_do',
                'in_progress',
                'in_review',
                'testing',
                'ready_for_release',
                'prod_check',
                'control',
                'closed'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "tasks" (
                "id" SERIAL NOT NULL,
                "title" character varying(150) NOT NULL DEFAULT '',
                "taskType" "public"."tasks_tasktype_enum" NOT NULL DEFAULT 'task',
                "project_id" integer,
                "planned_date" date,
                "parent_task_id" integer,
                "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'open',
                "priority" numeric NOT NULL DEFAULT '1',
                "deadline_date" date,
                "deadline_time_from" TIME,
                "deadline_time_to" TIME,
                "responsible_id" integer,
                "description" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}',
                "story_points" integer,
                "closed_date" TIMESTAMP,
                "recurrence_days" integer array,
                "recurrence_since" date,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_864e0a8c302147c9a67ef9c805" CHECK (char_length(title) >= 3),
                CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id")
            );
            COMMENT ON COLUMN "tasks"."recurrence_days" IS 'Дни недели повторения: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб';
            COMMENT ON COLUMN "tasks"."recurrence_since" IS 'Дата с которой начинаются повторения задачи'
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_bd213ab7fa55f02309c5f23bbc" ON "tasks" ("priority")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'employee', 'guest')
        `);
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" SERIAL NOT NULL,
                "telegram_user_id" character varying,
                "yandex_id" character varying,
                "first_name" character varying(50) NOT NULL DEFAULT 'Имя',
                "last_name" character varying(50) NOT NULL DEFAULT 'Фамилия',
                "patronymic" character varying(50),
                "email" character varying,
                "photo_url" character varying,
                "hashed_password" character varying,
                "role" "public"."users_role_enum" NOT NULL DEFAULT 'employee',
                "hidden_menu_items" jsonb NOT NULL DEFAULT '[]',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "UQ_ba43f6d899989a24b7a52b05c27" UNIQUE ("yandex_id"),
                CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "work_schedules" (
                "id" SERIAL NOT NULL,
                "user_id" integer NOT NULL,
                "work_date" date NOT NULL,
                "start_time" TIME,
                "end_time" TIME,
                "hours" numeric(5, 2) NOT NULL DEFAULT '0',
                "is_day_off" boolean NOT NULL DEFAULT false,
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_f5251879700e5ca0d2e353fa34f" PRIMARY KEY ("id")
            );
            COMMENT ON COLUMN "work_schedules"."hours" IS 'Planned work hours for this slot'
        `);
    await queryRunner.query(`
            CREATE TABLE "wiki_pages" (
                "id" SERIAL NOT NULL,
                "name" character varying(80) NOT NULL DEFAULT 'Название страницы',
                "priority" integer NOT NULL DEFAULT '100',
                "description" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "project_id" integer,
                "parent_page_id" integer,
                CONSTRAINT "PK_ff448f4c3a7b7a87331e2e8eddb" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "user_task_filters" (
                "user_id" integer NOT NULL,
                "task_filters" jsonb NOT NULL,
                "collapsed_columns" jsonb NOT NULL DEFAULT '[]',
                "view_type" character varying NOT NULL DEFAULT 'list',
                CONSTRAINT "PK_3a26197b795e02e278399230635" PRIMARY KEY ("user_id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "task_completions" (
                "id" SERIAL NOT NULL,
                "task_id" integer NOT NULL,
                "user_id" integer NOT NULL,
                "completed_at" date NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_c9c25215a82514668ab1d72a04d" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "quick_links" (
                "id" SERIAL NOT NULL,
                "title" character varying(255) NOT NULL,
                "url" text NOT NULL,
                "user_id" integer NOT NULL,
                "project_id" integer NOT NULL,
                "position" integer NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_73f8b821de42c0a6aba7e7cb303" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "push_subscriptions" (
                "id" SERIAL NOT NULL,
                "user_id" integer NOT NULL,
                "endpoint" text NOT NULL,
                "p256dh" text NOT NULL,
                "auth" text NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_0008bdfd174e533a3f98bf9af16" UNIQUE ("endpoint"),
                CONSTRAINT "PK_757fc8f00c34f66832668dc2e53" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_push_subs_user" ON "push_subscriptions" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "notifications" (
                "id" SERIAL NOT NULL,
                "name" character varying NOT NULL DEFAULT '',
                "message" character varying NOT NULL DEFAULT '',
                "link" character varying NOT NULL DEFAULT 'Ссылка',
                "is_read" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "recipient_id" integer NOT NULL,
                CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."mail_account_type_enum" AS ENUM('personal', 'service')
        `);
    await queryRunner.query(`
            CREATE TABLE "mail_accounts" (
                "id" SERIAL NOT NULL,
                "address" character varying(255) NOT NULL,
                "display_name" character varying(255),
                "type" "public"."mail_account_type_enum" NOT NULL DEFAULT 'service',
                "user_id" integer,
                "is_active" boolean NOT NULL DEFAULT true,
                "signature_html" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_f6fedc308db4a238794ca1084b5" UNIQUE ("address"),
                CONSTRAINT "PK_f1b805fed4abfd6cf53b6f5255b" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "mail_attachments" (
                "id" SERIAL NOT NULL,
                "message_id" integer NOT NULL,
                "filename" character varying(512) NOT NULL,
                "content_type" character varying(255) NOT NULL,
                "size" integer NOT NULL,
                "s3_key" character varying(1024) NOT NULL,
                "content_id" character varying(255),
                "is_inline" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1b6ac15a94bd06175b552b539e4" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."mail_direction_enum" AS ENUM('inbound', 'outbound')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."mail_message_status_enum" AS ENUM('received', 'sent', 'failed', 'draft')
        `);
    await queryRunner.query(`
            CREATE TABLE "mail_messages" (
                "id" SERIAL NOT NULL,
                "thread_id" integer NOT NULL,
                "direction" "public"."mail_direction_enum" NOT NULL,
                "message_id" character varying(998),
                "in_reply_to" character varying(998),
                "references_header" text,
                "from_address" character varying(255) NOT NULL,
                "from_name" character varying(255),
                "to_addresses" jsonb NOT NULL DEFAULT '[]',
                "cc_addresses" jsonb NOT NULL DEFAULT '[]',
                "subject" character varying(998),
                "text_body" text,
                "html_body" text,
                "raw_s3_key" character varying(1024),
                "auth_results" jsonb,
                "is_read" boolean NOT NULL DEFAULT false,
                "status" "public"."mail_message_status_enum" NOT NULL DEFAULT 'received',
                "sent_by_user_id" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_1bd6e76ef3b3d4aff7d0510a509" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_11a47e63a64f1137a84de65a82" ON "mail_messages" ("message_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "mail_threads" (
                "id" SERIAL NOT NULL,
                "subject" character varying(998) NOT NULL,
                "account_id" integer NOT NULL,
                "task_id" integer,
                "project_id" integer,
                "counterparty_address" character varying(255),
                "last_message_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                "folder" character varying(16) NOT NULL DEFAULT 'inbox',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_62b770b513ea48cdf23d4ed550a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "healthchecks" (
                "id" SERIAL NOT NULL,
                "name" character varying(255) NOT NULL,
                "url" character varying(1000) NOT NULL,
                "interval_seconds" integer NOT NULL DEFAULT '60',
                "timeout_seconds" integer NOT NULL DEFAULT '10',
                "expected_status" integer NOT NULL DEFAULT '200',
                "chat_id" character varying(36) NOT NULL,
                "sender_user_id" integer NOT NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                "last_status" character varying(20) NOT NULL DEFAULT 'unknown',
                "last_checked_at" TIMESTAMP,
                "last_error" character varying(500),
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6e39317ebd7d4e7a6c78fdbc6df" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "repos" (
                "id" SERIAL NOT NULL,
                "project_id" integer,
                "name" character varying NOT NULL,
                "gitdir" text NOT NULL,
                "default_branch" character varying NOT NULL DEFAULT 'main',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_50f4cdbc4e114515f41760400ba" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_repos_project_name" ON "repos" ("project_id", "name")
        `);
    await queryRunner.query(`
            CREATE TABLE "comments" (
                "id" SERIAL NOT NULL,
                "message" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}',
                "task_id" integer,
                "resolved" boolean NOT NULL DEFAULT false,
                "author_id" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "comment_id" integer,
                CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "chat_messages" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "sender_id" integer,
                "message" jsonb,
                "is_edited" boolean NOT NULL DEFAULT false,
                "is_deleted" boolean NOT NULL DEFAULT false,
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "reply_to_id" uuid,
                "edited_at" TIMESTAMP WITH TIME ZONE,
                "chat_id" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_chat_messages_reply_to" ON "chat_messages" ("reply_to_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_chat_messages_sender" ON "chat_messages" ("sender_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_chat_messages_chat_created" ON "chat_messages" ("chat_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "chat_members" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "chat_id" uuid NOT NULL,
                "user_id" integer NOT NULL,
                "role" character varying(16) NOT NULL DEFAULT 'member',
                "left_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "uq_chat_member" UNIQUE ("chat_id", "user_id"),
                CONSTRAINT "PK_aea646f59c92c47af5804ce73a7" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_chat_members_user" ON "chat_members" ("user_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_chat_members_chat" ON "chat_members" ("chat_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."chats_type_enum" AS ENUM('direct', 'group')
        `);
    await queryRunner.query(`
            CREATE TABLE "chats" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "type" "public"."chats_type_enum" NOT NULL,
                "name" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "chat_message_reads" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "message_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "uq_message_user_read" UNIQUE ("message_id", "user_id"),
                CONSTRAINT "PK_be708581c7ff620908217ff381a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_reads_message" ON "chat_message_reads" ("message_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_reads_user" ON "chat_message_reads" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "chat_message_read_status" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" integer NOT NULL,
                "message_id" uuid NOT NULL,
                "read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_c3ed79341e99347977e4c39c51e" UNIQUE ("user_id", "message_id"),
                CONSTRAINT "PK_2b7102a1665386d0f2e23927dba" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "changelogs" (
                "id" SERIAL NOT NULL,
                "title" character varying(255) NOT NULL,
                "body" jsonb,
                "is_published" boolean NOT NULL DEFAULT false,
                "author_id" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_e33d9b851f9ab2b646dbfe659d9" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "changelog_views" (
                "id" SERIAL NOT NULL,
                "user_id" integer NOT NULL,
                "changelog_id" integer NOT NULL,
                "viewed_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_976f842efadf3144551c3e46cd5" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."audit_logs_action_type_enum" AS ENUM(
                'auth.login_success',
                'auth.login_failed',
                'auth.logout',
                'tasks.created',
                'tasks.updated',
                'tasks.deleted',
                'tasks.completed',
                'tasks.uncompleted',
                'tasks.recurrence_changed',
                'projects.created',
                'projects.updated',
                'projects.deleted',
                'projects.members_updated',
                'users.created',
                'users.updated',
                'users.archived',
                'users.restored',
                'api_tokens.created',
                'api_tokens.deleted',
                'timelogs.created',
                'timelogs.updated',
                'timelogs.deleted'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."audit_logs_entity_type_enum" AS ENUM(
                'auth',
                'task',
                'project',
                'user',
                'api_token',
                'timelog'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."audit_logs_source_type_enum" AS ENUM('web', 'api_token', 'system')
        `);
    await queryRunner.query(`
            CREATE TABLE "audit_logs" (
                "id" SERIAL NOT NULL,
                "action_type" "public"."audit_logs_action_type_enum" NOT NULL,
                "entity_type" "public"."audit_logs_entity_type_enum" NOT NULL,
                "entity_id" character varying(128),
                "entity_label" character varying(255),
                "summary" character varying(500) NOT NULL,
                "before_payload" jsonb,
                "after_payload" jsonb,
                "diff_payload" jsonb,
                "metadata_payload" jsonb,
                "source_type" "public"."audit_logs_source_type_enum" NOT NULL DEFAULT 'web',
                "actor_id" integer,
                "actor_name" character varying(255),
                "project_id" integer,
                "task_id" integer,
                "request_id" character varying(64),
                "request_method" character varying(16),
                "request_path" character varying(512),
                "ip_address" character varying(64),
                "user_agent" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_cdc15ea4d795d9a65791d91536" ON "audit_logs" ("task_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_5e124016d61fe935a7f10ac3fa" ON "audit_logs" ("project_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_ea9ba3dfb39050f831ee3be40d" ON "audit_logs" ("entity_type")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_0a18c37e4353a67e70f7924e86" ON "audit_logs" ("action_type")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_177183f29f438c488b5e8510cd" ON "audit_logs" ("actor_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2cd10fda8276bb995288acfbfb" ON "audit_logs" ("created_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "api_tokens" (
                "id" SERIAL NOT NULL,
                "name" character varying(255) NOT NULL,
                "token_hash" character varying(64) NOT NULL,
                "user_id" integer NOT NULL,
                "last_used_at" TIMESTAMP,
                "expires_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_bbd687a104e1921e6702c6e3aad" UNIQUE ("token_hash"),
                CONSTRAINT "PK_c587455266b5fa8dace7194caac" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "allocations" (
                "id" SERIAL NOT NULL,
                "user_id" integer NOT NULL,
                "project_id" integer NOT NULL,
                "start_date" date NOT NULL,
                "end_date" date NOT NULL,
                "start_time" TIME,
                "end_time" TIME,
                "hours" integer NOT NULL DEFAULT '8',
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ca63099fc248466264af0fa6f1f" PRIMARY KEY ("id")
            );
            COMMENT ON COLUMN "allocations"."hours" IS 'Hours per day'
        `);
    await queryRunner.query(`
            CREATE TABLE "tasks_participants" (
                "task_id" integer NOT NULL,
                "user_id" integer NOT NULL,
                CONSTRAINT "PK_68fc72bd37dbb7d54148843be06" PRIMARY KEY ("task_id", "user_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_500794f87ca24130121c7c45b2" ON "tasks_participants" ("task_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_068dc897b2e09dae8a7f14e08c" ON "tasks_participants" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "task_relations" (
                "task_id" integer NOT NULL,
                "related_task_id" integer NOT NULL,
                CONSTRAINT "PK_4552beefab30659efea0f914d5a" PRIMARY KEY ("task_id", "related_task_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_48d69ec95ce2f5cc8cd684b982" ON "task_relations" ("task_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_8df3e3f103114f679df8bc263d" ON "task_relations" ("related_task_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "mail_account_access" (
                "mail_account_id" integer NOT NULL,
                "user_id" integer NOT NULL,
                CONSTRAINT "PK_fcbe154cf7657d59c8326cbafdd" PRIMARY KEY ("mail_account_id", "user_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_713ca30eb946beb2236bd53bf8" ON "mail_account_access" ("mail_account_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_6ed32a900ac01f2db86bcdfbb5" ON "mail_account_access" ("user_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "project_members"
            ADD CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "project_members"
            ADD CONSTRAINT "FK_b5729113570c20c7e214cf3f58d" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "timelogs"
            ADD CONSTRAINT "FK_4fee65b05008be16aa0c4335765" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "timelogs"
            ADD CONSTRAINT "FK_3f8d97321219ae2b341b724ee26" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_9eecdb5b1ed8c7c2a1b392c28d4" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_54fc42a253a8338488ec1f960ad" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_bfb47e71ef6c93aebeedf07f28c" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "work_schedules"
            ADD CONSTRAINT "FK_a227fc13276caa5c42c59e4f362" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "wiki_pages"
            ADD CONSTRAINT "FK_964d5f9a357053d7e8f3176b16b" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "wiki_pages"
            ADD CONSTRAINT "FK_f878630b7cfbbd6c221d420d31d" FOREIGN KEY ("parent_page_id") REFERENCES "wiki_pages"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "user_task_filters"
            ADD CONSTRAINT "FK_3a26197b795e02e278399230635" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_completions"
            ADD CONSTRAINT "FK_3967800678c1fa2c32358f76580" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_completions"
            ADD CONSTRAINT "FK_83822dd8163260f40b3b9189147" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "quick_links"
            ADD CONSTRAINT "FK_67bafffbf783ab57578ec3fbfae" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "quick_links"
            ADD CONSTRAINT "FK_4442962404353b2ad525dea0a62" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "notifications"
            ADD CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_accounts"
            ADD CONSTRAINT "FK_f2a73f5806ca3ca46bee5163570" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_attachments"
            ADD CONSTRAINT "FK_89806f9414d2ac0b6687570fb2f" FOREIGN KEY ("message_id") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_messages"
            ADD CONSTRAINT "FK_77a618371fd70fd891bef70aa67" FOREIGN KEY ("thread_id") REFERENCES "mail_threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_messages"
            ADD CONSTRAINT "FK_c226b3b4eb5cce7d286bf677fd9" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_threads"
            ADD CONSTRAINT "FK_e8980ad5ddb89d64f621e0178f2" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_threads"
            ADD CONSTRAINT "FK_01e72abb3f6bbf573bba26ad54a" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "comments"
            ADD CONSTRAINT "FK_18c2493067c11f44efb35ca0e03" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "comments"
            ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "comments"
            ADD CONSTRAINT "FK_eb0d76f2ca45d66a7de04c7c72b" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages"
            ADD CONSTRAINT "FK_9f5c0b96255734666b7b4bc98c3" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages"
            ADD CONSTRAINT "FK_9e5fc47ecb06d4d7b84633b1718" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_members"
            ADD CONSTRAINT "FK_29ffb4b6edf59a7862129765339" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_members"
            ADD CONSTRAINT "FK_9dc61e92eed1dc151c2b2ef01a0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_message_read_status"
            ADD CONSTRAINT "FK_e16f05fc69fb5841fcd85f70f04" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_message_read_status"
            ADD CONSTRAINT "FK_1571dbac418d09d8e12bd49e606" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "changelogs"
            ADD CONSTRAINT "FK_95e0204e11cb33999bddb86d719" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "changelog_views"
            ADD CONSTRAINT "FK_72a69137a6f5f2372ac7a0df2ab" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "changelog_views"
            ADD CONSTRAINT "FK_d07120f7350db4de333116d9de2" FOREIGN KEY ("changelog_id") REFERENCES "changelogs"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_logs"
            ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "api_tokens"
            ADD CONSTRAINT "FK_b74883f5884a42fd8496d389b25" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "allocations"
            ADD CONSTRAINT "FK_28409a4ad876dc3ae8ce0a665bd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "allocations"
            ADD CONSTRAINT "FK_1e9073e8826a16fd21cbbece599" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks_participants"
            ADD CONSTRAINT "FK_500794f87ca24130121c7c45b2c" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks_participants"
            ADD CONSTRAINT "FK_068dc897b2e09dae8a7f14e08c0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "task_relations"
            ADD CONSTRAINT "FK_48d69ec95ce2f5cc8cd684b982f" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "task_relations"
            ADD CONSTRAINT "FK_8df3e3f103114f679df8bc263d7" FOREIGN KEY ("related_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_account_access"
            ADD CONSTRAINT "FK_713ca30eb946beb2236bd53bf8d" FOREIGN KEY ("mail_account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_account_access"
            ADD CONSTRAINT "FK_6ed32a900ac01f2db86bcdfbb53" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const legacyHead = await queryRunner.query('SELECT 1 FROM "migrations" WHERE "name" = $1 LIMIT 1', [LEGACY_HEAD_MIGRATION]);
    if (legacyHead.length > 0) return;

    await queryRunner.query(`
            ALTER TABLE "mail_account_access" DROP CONSTRAINT "FK_6ed32a900ac01f2db86bcdfbb53"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_account_access" DROP CONSTRAINT "FK_713ca30eb946beb2236bd53bf8d"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_relations" DROP CONSTRAINT "FK_8df3e3f103114f679df8bc263d7"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_relations" DROP CONSTRAINT "FK_48d69ec95ce2f5cc8cd684b982f"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks_participants" DROP CONSTRAINT "FK_068dc897b2e09dae8a7f14e08c0"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks_participants" DROP CONSTRAINT "FK_500794f87ca24130121c7c45b2c"
        `);
    await queryRunner.query(`
            ALTER TABLE "allocations" DROP CONSTRAINT "FK_1e9073e8826a16fd21cbbece599"
        `);
    await queryRunner.query(`
            ALTER TABLE "allocations" DROP CONSTRAINT "FK_28409a4ad876dc3ae8ce0a665bd"
        `);
    await queryRunner.query(`
            ALTER TABLE "api_tokens" DROP CONSTRAINT "FK_b74883f5884a42fd8496d389b25"
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"
        `);
    await queryRunner.query(`
            ALTER TABLE "changelog_views" DROP CONSTRAINT "FK_d07120f7350db4de333116d9de2"
        `);
    await queryRunner.query(`
            ALTER TABLE "changelog_views" DROP CONSTRAINT "FK_72a69137a6f5f2372ac7a0df2ab"
        `);
    await queryRunner.query(`
            ALTER TABLE "changelogs" DROP CONSTRAINT "FK_95e0204e11cb33999bddb86d719"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_message_read_status" DROP CONSTRAINT "FK_1571dbac418d09d8e12bd49e606"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_message_read_status" DROP CONSTRAINT "FK_e16f05fc69fb5841fcd85f70f04"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_members" DROP CONSTRAINT "FK_9dc61e92eed1dc151c2b2ef01a0"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_members" DROP CONSTRAINT "FK_29ffb4b6edf59a7862129765339"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_9e5fc47ecb06d4d7b84633b1718"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_9f5c0b96255734666b7b4bc98c3"
        `);
    await queryRunner.query(`
            ALTER TABLE "comments" DROP CONSTRAINT "FK_eb0d76f2ca45d66a7de04c7c72b"
        `);
    await queryRunner.query(`
            ALTER TABLE "comments" DROP CONSTRAINT "FK_e6d38899c31997c45d128a8973b"
        `);
    await queryRunner.query(`
            ALTER TABLE "comments" DROP CONSTRAINT "FK_18c2493067c11f44efb35ca0e03"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_threads" DROP CONSTRAINT "FK_01e72abb3f6bbf573bba26ad54a"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_threads" DROP CONSTRAINT "FK_e8980ad5ddb89d64f621e0178f2"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_c226b3b4eb5cce7d286bf677fd9"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_messages" DROP CONSTRAINT "FK_77a618371fd70fd891bef70aa67"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_attachments" DROP CONSTRAINT "FK_89806f9414d2ac0b6687570fb2f"
        `);
    await queryRunner.query(`
            ALTER TABLE "mail_accounts" DROP CONSTRAINT "FK_f2a73f5806ca3ca46bee5163570"
        `);
    await queryRunner.query(`
            ALTER TABLE "notifications" DROP CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d"
        `);
    await queryRunner.query(`
            ALTER TABLE "quick_links" DROP CONSTRAINT "FK_4442962404353b2ad525dea0a62"
        `);
    await queryRunner.query(`
            ALTER TABLE "quick_links" DROP CONSTRAINT "FK_67bafffbf783ab57578ec3fbfae"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_completions" DROP CONSTRAINT "FK_83822dd8163260f40b3b9189147"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_completions" DROP CONSTRAINT "FK_3967800678c1fa2c32358f76580"
        `);
    await queryRunner.query(`
            ALTER TABLE "user_task_filters" DROP CONSTRAINT "FK_3a26197b795e02e278399230635"
        `);
    await queryRunner.query(`
            ALTER TABLE "wiki_pages" DROP CONSTRAINT "FK_f878630b7cfbbd6c221d420d31d"
        `);
    await queryRunner.query(`
            ALTER TABLE "wiki_pages" DROP CONSTRAINT "FK_964d5f9a357053d7e8f3176b16b"
        `);
    await queryRunner.query(`
            ALTER TABLE "work_schedules" DROP CONSTRAINT "FK_a227fc13276caa5c42c59e4f362"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_bfb47e71ef6c93aebeedf07f28c"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_54fc42a253a8338488ec1f960ad"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_9eecdb5b1ed8c7c2a1b392c28d4"
        `);
    await queryRunner.query(`
            ALTER TABLE "timelogs" DROP CONSTRAINT "FK_3f8d97321219ae2b341b724ee26"
        `);
    await queryRunner.query(`
            ALTER TABLE "timelogs" DROP CONSTRAINT "FK_4fee65b05008be16aa0c4335765"
        `);
    await queryRunner.query(`
            ALTER TABLE "project_members" DROP CONSTRAINT "FK_b5729113570c20c7e214cf3f58d"
        `);
    await queryRunner.query(`
            ALTER TABLE "project_members" DROP CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_6ed32a900ac01f2db86bcdfbb5"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_713ca30eb946beb2236bd53bf8"
        `);
    await queryRunner.query(`
            DROP TABLE "mail_account_access"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_8df3e3f103114f679df8bc263d"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_48d69ec95ce2f5cc8cd684b982"
        `);
    await queryRunner.query(`
            DROP TABLE "task_relations"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_068dc897b2e09dae8a7f14e08c"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_500794f87ca24130121c7c45b2"
        `);
    await queryRunner.query(`
            DROP TABLE "tasks_participants"
        `);
    await queryRunner.query(`
            DROP TABLE "allocations"
        `);
    await queryRunner.query(`
            DROP TABLE "api_tokens"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2cd10fda8276bb995288acfbfb"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_177183f29f438c488b5e8510cd"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_0a18c37e4353a67e70f7924e86"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_ea9ba3dfb39050f831ee3be40d"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_5e124016d61fe935a7f10ac3fa"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_cdc15ea4d795d9a65791d91536"
        `);
    await queryRunner.query(`
            DROP TABLE "audit_logs"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."audit_logs_source_type_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."audit_logs_entity_type_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."audit_logs_action_type_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "changelog_views"
        `);
    await queryRunner.query(`
            DROP TABLE "changelogs"
        `);
    await queryRunner.query(`
            DROP TABLE "chat_message_read_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_reads_user"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_reads_message"
        `);
    await queryRunner.query(`
            DROP TABLE "chat_message_reads"
        `);
    await queryRunner.query(`
            DROP TABLE "chats"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."chats_type_enum"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_chat_members_chat"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_chat_members_user"
        `);
    await queryRunner.query(`
            DROP TABLE "chat_members"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_chat_messages_chat_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_chat_messages_sender"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_chat_messages_reply_to"
        `);
    await queryRunner.query(`
            DROP TABLE "chat_messages"
        `);
    await queryRunner.query(`
            DROP TABLE "comments"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_repos_project_name"
        `);
    await queryRunner.query(`
            DROP TABLE "repos"
        `);
    await queryRunner.query(`
            DROP TABLE "healthchecks"
        `);
    await queryRunner.query(`
            DROP TABLE "mail_threads"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_11a47e63a64f1137a84de65a82"
        `);
    await queryRunner.query(`
            DROP TABLE "mail_messages"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."mail_message_status_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."mail_direction_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "mail_attachments"
        `);
    await queryRunner.query(`
            DROP TABLE "mail_accounts"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."mail_account_type_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "notifications"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."idx_push_subs_user"
        `);
    await queryRunner.query(`
            DROP TABLE "push_subscriptions"
        `);
    await queryRunner.query(`
            DROP TABLE "quick_links"
        `);
    await queryRunner.query(`
            DROP TABLE "task_completions"
        `);
    await queryRunner.query(`
            DROP TABLE "user_task_filters"
        `);
    await queryRunner.query(`
            DROP TABLE "wiki_pages"
        `);
    await queryRunner.query(`
            DROP TABLE "work_schedules"
        `);
    await queryRunner.query(`
            DROP TABLE "users"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."users_role_enum"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bd213ab7fa55f02309c5f23bbc"
        `);
    await queryRunner.query(`
            DROP TABLE "tasks"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."tasks_status_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."tasks_tasktype_enum"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."unique_active_timelogs_per_task_author"
        `);
    await queryRunner.query(`
            DROP TABLE "timelogs"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."timelogs_status_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "project_members"
        `);
    await queryRunner.query(`
            DROP TABLE "projects"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."projects_status_enum"
        `);
  }
}
