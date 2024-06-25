import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContactViewsColumnToTeam1715496113639 implements MigrationInterface {
    name = 'AddContactViewsColumnToTeam1715496113639'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "contact_views" jsonb DEFAULT '[]'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "contact_views"`);
    }
}
