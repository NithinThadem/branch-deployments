import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCallFailureReason1716834313884 implements MigrationInterface {
    name = 'AddCallFailureReason1716834313884'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" ADD "call_failure_reason" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview_response" DROP COLUMN "call_failure_reason"`);
    }

}
