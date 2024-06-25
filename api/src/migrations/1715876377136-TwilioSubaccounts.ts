import { MigrationInterface, QueryRunner } from "typeorm";

export class TwilioSubaccounts1715876377136 implements MigrationInterface {
    name = 'TwilioSubaccounts1715876377136'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" ADD "twilio_account_sid" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "twilio_account_sid"`);
    }

}
