import { MigrationInterface, QueryRunner } from "typeorm";

export class TwilioVerification1716333323714 implements MigrationInterface {
    name = 'TwilioVerification1716333323714'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add twilio_metadata column if it doesn't already exist, with default value of {}
        await queryRunner.query(`
            ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "twilio_metadata" jsonb NOT NULL DEFAULT '{}'
        `);

        // Add twilio_account_secret column if it doesn't already exist
        await queryRunner.query(`
            ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "twilio_account_secret" character varying
        `);

        // Transfer existing columns to legacy_metadata
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'team' AND column_name = 'twilio_customer_profile_sid') THEN
                    UPDATE "team"
                    SET "twilio_metadata" = jsonb_set(
                        COALESCE("twilio_metadata", '{}'),
                        '{legacy_metadata}',
                        jsonb_build_object(
                            'twilio_customer_profile_sid', "twilio_customer_profile_sid",
                            'twilio_customer_profile_status', "twilio_customer_profile_status",
                            'twilio_customer_profile_failure_reason', "twilio_customer_profile_failure_reason"
                        )
                    )
                    WHERE "twilio_customer_profile_sid" IS NOT NULL OR
                        "twilio_customer_profile_status" IS NOT NULL OR
                        "twilio_customer_profile_failure_reason" IS NOT NULL;
                END IF;
            END $$;
        `);

        // Drop the columns if they exist
        const columnsToDrop = [
            'twilio_customer_profile_failure_reason',
            'twilio_customer_profile_status',
            'twilio_customer_profile_sid'
        ];

        for (const column of columnsToDrop) {
            await queryRunner.query(`
                DO $$ 
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_name = 'team' AND column_name = '${column}'
                    ) THEN
                        ALTER TABLE "team" DROP COLUMN "${column}";
                    END IF;
                END $$;
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Add the columns back
        await queryRunner.query(`ALTER TABLE "team" ADD COLUMN "twilio_customer_profile_failure_reason" character varying`);
        await queryRunner.query(`ALTER TABLE "team" ADD COLUMN "twilio_customer_profile_status" character varying`);
        await queryRunner.query(`ALTER TABLE "team" ADD COLUMN "twilio_customer_profile_sid" character varying`);

        // Restore columns from legacy_metadata
        await queryRunner.query(`
            UPDATE "team"
            SET "twilio_customer_profile_sid" = "twilio_metadata"->'legacy_metadata'->>'twilio_customer_profile_sid',
                "twilio_customer_profile_status" = "twilio_metadata"->'legacy_metadata'->>'twilio_customer_profile_status',
                "twilio_customer_profile_failure_reason" = "twilio_metadata"->'legacy_metadata'->>'twilio_customer_profile_failure_reason'
        `);

        // Drop the twilio_metadata column
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_metadata"`);

        // Drop the twilio_account_secret column
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_account_secret"`);
    }
}
