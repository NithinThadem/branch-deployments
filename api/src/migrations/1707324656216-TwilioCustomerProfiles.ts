import { MigrationInterface, QueryRunner } from "typeorm";

export class TwilioCustomerProfiles1707324656216 implements MigrationInterface {
    name = 'TwilioCustomerProfiles1707324656216'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_sid" character varying`);
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_status" character varying NOT NULL DEFAULT 'draft'`);
        await queryRunner.query(`ALTER TABLE "team" ADD "business_metadata" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "business_metadata"`);
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_status"`);
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_sid"`);
    }

}
