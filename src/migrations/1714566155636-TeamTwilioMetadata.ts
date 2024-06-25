import { MigrationInterface, QueryRunner } from "typeorm";

export class TeamTwilioMetadata1714566155636 implements MigrationInterface {
    name = 'TeamTwilioMetadata1714566155636'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_metadata" jsonb NOT NULL DEFAULT '{"twilio_customer_a2p_bundle_status":"draft","twilio_customer_a2p_brand_status":"draft","twilio_customer_a2p_campaign_status":"draft","twilio_shaken_stir_status":"draft","twilio_customer_profile_status":"draft"}'`);

        // Populate the new column with merged data
        await queryRunner.query(`
            UPDATE team SET twilio_metadata = jsonb_build_object(
                'twilio_customer_profile_sid', twilio_customer_profile_sid,
                'twilio_customer_profile_status', twilio_customer_profile_status,
                'twilio_customer_profile_failure_reason', twilio_customer_profile_failure_reason,
                'twilio_customer_a2p_bundle_status', 'draft',
                'twilio_customer_a2p_brand_status', 'draft',
                'twilio_customer_a2p_campaign_status', 'draft',
                'twilio_shaken_stir_status', 'draft'
            )
        `);

        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_failure_reason"`);
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_sid"`);
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_customer_profile_status"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_failure_reason" character varying`);
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_status" character varying`);
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_customer_profile_sid" character varying`);

        // Restore the old data from twilio_metadata
        await queryRunner.query(`
            UPDATE team SET
                twilio_customer_profile_sid = twilio_metadata->>'twilio_customer_profile_sid',
                twilio_customer_profile_status = twilio_metadata->>'twilio_customer_profile_status',
                twilio_customer_profile_failure_reason = twilio_metadata->>'twilio_customer_profile_failure_reason'
        `);

        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_metadata"`);
    }

}
