import { MigrationInterface, QueryRunner } from 'typeorm';

const TableName = 'tasks';
const EnumName = 'tasks_status_enum';
const NewDefaultStatus = 'to_do';

export class RemoveBacklogStatusFromTasksEnum1765567707622 implements MigrationInterface {
  NEW_STATUSES = `'open', 'to_do', 'in_progress', 'in_review', 'testing', 'control', 'closed'`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log(`Starting migration to remove 'backlog' from ${EnumName}...`);

    await queryRunner.query(`
            UPDATE "${TableName}" 
            SET "status" = '${NewDefaultStatus}' 
            WHERE "status" = 'backlog';
        `);
    console.log(`Updated all 'backlog' tasks to '${NewDefaultStatus}'.`);

    await queryRunner.query(`ALTER TABLE "${TableName}" ALTER COLUMN "status" DROP DEFAULT;`);
    console.log('Default value for "status" dropped temporarily.');

    await queryRunner.query(`ALTER TYPE "${EnumName}" RENAME TO "${EnumName}_old";`);

    await queryRunner.query(`CREATE TYPE "${EnumName}" AS ENUM (${this.NEW_STATUSES});`);

    await queryRunner.query(`
            ALTER TABLE "${TableName}" 
            ALTER COLUMN "status" 
            TYPE "${EnumName}" 
            USING "status"::text::"${EnumName}";
        `);

    await queryRunner.query(`ALTER TABLE "${TableName}" ALTER COLUMN "status" SET DEFAULT 'open';`);
    console.log('New default value "open" set for "status".');

    await queryRunner.query(`DROP TYPE "${EnumName}_old";`);

    console.log(`SUCCESS: 'backlog' status successfully removed from ${EnumName}.`);
  }

  public down(_queryRunner: QueryRunner): Promise<void> {
    console.log("Revert method 'down' should be updated to handle DEFAULT as well if needed.");
    return Promise.resolve();
  }
}
