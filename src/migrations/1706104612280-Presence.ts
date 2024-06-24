import { MigrationInterface, QueryRunner } from "typeorm";

export class Presence1706104612280 implements MigrationInterface {
    name = 'Presence1706104612280'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ADD "presence_interim_audio" character varying`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "presence_background_audio" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "presence_background_audio"`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "presence_interim_audio"`);
    }

}
