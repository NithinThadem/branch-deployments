import { MigrationInterface, QueryRunner } from "typeorm";

export class InterviewResponseMetadata1708315842080 implements MigrationInterface {
    name = 'InterviewResponseMetadata1708315842080'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" ADD "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" DROP COLUMN "metadata"`);
    }

}
