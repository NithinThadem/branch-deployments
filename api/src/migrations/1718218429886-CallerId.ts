import { MigrationInterface, QueryRunner } from "typeorm";

export class CallerId1718218429886 implements MigrationInterface {
    name = 'CallerId1718218429886'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "caller_id" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "team_id" uuid NOT NULL, "phone_number" character varying NOT NULL, "twilio_sid" character varying, CONSTRAINT "PK_df2f7fa7708bfb716623411d04f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "caller_id_id" uuid`);
        await queryRunner.query(`ALTER TABLE "caller_id" ADD CONSTRAINT "FK_a11e4b80e4b009007dc0bd5dd9d" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "interview" ADD CONSTRAINT "FK_41018722b1627ac8851881c7a47" FOREIGN KEY ("caller_id_id") REFERENCES "caller_id"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP CONSTRAINT "FK_41018722b1627ac8851881c7a47"`);
        await queryRunner.query(`ALTER TABLE "caller_id" DROP CONSTRAINT "FK_a11e4b80e4b009007dc0bd5dd9d"`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "caller_id_id"`);
        await queryRunner.query(`DROP TABLE "caller_id"`);
    }

}
