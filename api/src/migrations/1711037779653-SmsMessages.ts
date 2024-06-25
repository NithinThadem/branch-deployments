import { MigrationInterface, QueryRunner } from "typeorm";

export class SmsMessages1711037779653 implements MigrationInterface {
    name = 'SmsMessages1711037779653'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sms_message" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "team_id" uuid NOT NULL, "phone_number_id" uuid NOT NULL, "status" character varying NOT NULL, "twilio_sid" character varying NOT NULL, "body" character varying NOT NULL, "from" character varying NOT NULL, "to" character varying NOT NULL, "twilio_metadata" jsonb, CONSTRAINT "PK_121900f2127a5152cf20898a11c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "sms_message" ADD CONSTRAINT "FK_47c7d86be57ea96a63494e60023" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sms_message" ADD CONSTRAINT "FK_7a4c6839dd20db82b380fbff3c2" FOREIGN KEY ("phone_number_id") REFERENCES "phone_number"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_teams" DROP CONSTRAINT "FK_006715ef1e1b40852f379efe567"`);
        await queryRunner.query(`ALTER TABLE "sms_message" DROP CONSTRAINT "FK_7a4c6839dd20db82b380fbff3c2"`);
        await queryRunner.query(`ALTER TABLE "sms_message" DROP CONSTRAINT "FK_47c7d86be57ea96a63494e60023"`);
        await queryRunner.query(`DROP TABLE "sms_message"`);
    }

}
