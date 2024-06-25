import { MigrationInterface, QueryRunner } from "typeorm";

export class RecordingUrl1704997721379 implements MigrationInterface {
    name = 'RecordingUrl1704997721379'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" ADD "recording_url" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" DROP COLUMN "recording_url"`);
    }

}
