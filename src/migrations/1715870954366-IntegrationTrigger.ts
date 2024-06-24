import { MigrationInterface, QueryRunner } from "typeorm";

export class IntegrationTrigger1715870954366 implements MigrationInterface {
    name = 'IntegrationTrigger1715870954366'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."trigger_status_enum" AS ENUM('start', 'end')`);
        await queryRunner.query(`CREATE TABLE "trigger" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "subscription_type" character varying NOT NULL, "name" character varying NOT NULL, "type" "public"."trigger_status_enum" NOT NULL DEFAULT 'start', "integration_id" uuid, "interview_id" character varying(8), CONSTRAINT "PK_fc6b3cbbe199d89c002831e03e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "trigger" ADD CONSTRAINT "FK_aac4cfe6ffd1220a5af80cffe53" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trigger" ADD CONSTRAINT "FK_223bfca16776702a448b68aa961" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trigger" DROP CONSTRAINT "FK_223bfca16776702a448b68aa961"`);
        await queryRunner.query(`ALTER TABLE "trigger" DROP CONSTRAINT "FK_aac4cfe6ffd1220a5af80cffe53"`);
        await queryRunner.query(`DROP TABLE "trigger"`);
        await queryRunner.query(`DROP TYPE "public"."trigger_status_enum"`);
    }

}
