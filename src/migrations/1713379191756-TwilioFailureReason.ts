import { MigrationInterface, QueryRunner } from "typeorm";

export class TwilioFailureReason1713379191756 implements MigrationInterface {
    name = 'TwilioFailureReason1713379191756'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_failure_reason" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_failure_reason"`);
    }

}
