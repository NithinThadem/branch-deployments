import { MigrationInterface, QueryRunner } from "typeorm";

export class Market1707227157919 implements MigrationInterface {
    name = 'Market1707227157919'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "market" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "listing_name" text NOT NULL, "description" text NOT NULL DEFAULT '', "tags" text array DEFAULT array[]::text[], "price" bigint NOT NULL DEFAULT '0', "image_url" text, "demo_url" text, "interview_id" character varying(8), CONSTRAINT "REL_96494056d05fbc2d3f31501087" UNIQUE ("interview_id"), CONSTRAINT "PK_1e9a2963edfd331d92018e3abac" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "market" ADD CONSTRAINT "FK_96494056d05fbc2d3f31501087d" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "market" DROP CONSTRAINT "FK_96494056d05fbc2d3f31501087d"`);
        await queryRunner.query(`DROP TABLE "market"`);
    }

}
