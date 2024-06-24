import { MigrationInterface, QueryRunner } from "typeorm";

export class InterviewResponseTags1705930615975 implements MigrationInterface {
    name = 'InterviewResponseTags1705930615975'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ADD "response_tags" text array DEFAULT array[]::text[]`);
        await queryRunner.query(`ALTER TABLE "interview_response" ADD "summary_data" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" DROP COLUMN "summary_data"`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "response_tags"`);
    }

}
