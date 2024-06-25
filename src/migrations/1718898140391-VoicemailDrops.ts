import { MigrationInterface, QueryRunner } from "typeorm";

export class VoicemailDrops1718898140391 implements MigrationInterface {
    name = 'VoicemailDrops1718898140391'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ADD "should_leave_voicemail" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "voicemail_message" character varying NOT NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "voicemail_message"`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "should_leave_voicemail"`);
    }

}
