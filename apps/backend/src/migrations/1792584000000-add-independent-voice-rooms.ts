import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndependentVoiceRooms1792584000000 implements MigrationInterface {
  name = 'AddIndependentVoiceRooms1792584000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "voice_rooms" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR(120) NOT NULL,
        "owner_id" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_voice_rooms" PRIMARY KEY ("id"),
        CONSTRAINT "FK_voice_rooms_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_voice_rooms_owner" ON "voice_rooms" ("owner_id")`);
    await queryRunner.query(`
      CREATE TABLE "voice_room_members" (
        "room_id" INTEGER NOT NULL,
        "user_id" INTEGER NOT NULL,
        CONSTRAINT "PK_voice_room_members" PRIMARY KEY ("room_id", "user_id"),
        CONSTRAINT "FK_voice_room_members_room" FOREIGN KEY ("room_id") REFERENCES "voice_rooms"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_voice_room_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_voice_room_members_user" ON "voice_room_members" ("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "voice_room_members"`);
    await queryRunner.query(`DROP TABLE "voice_rooms"`);
  }
}
