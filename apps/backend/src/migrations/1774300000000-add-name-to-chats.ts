import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddNameToChats1774300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'chats',
      new TableColumn({
        name: 'name',
        type: 'varchar',
        isNullable: true,
        default: null,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('chats', 'name');
  }
}
