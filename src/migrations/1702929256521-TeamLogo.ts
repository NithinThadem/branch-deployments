import { MigrationInterface, QueryRunner } from "typeorm";

export class TeamLogo1702929256521 implements MigrationInterface {
    name = 'TeamLogo1702929256521'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "logo_url" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "logo_url"`);
    }

}