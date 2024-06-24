import { MigrationInterface, QueryRunner } from "typeorm";

export class InboundOutbound1708987572355 implements MigrationInterface {
    name = 'InboundOutbound1708987572355'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "phone_number" ADD "inbound_interview_id" character varying(8)`);
        await queryRunner.query(`ALTER TABLE "phone_number" ADD CONSTRAINT "UQ_88c08c11fd97e4bca93507651b1" UNIQUE ("inbound_interview_id")`);
        await queryRunner.query(`ALTER TABLE "phone_number" ADD "outbound_interview_id" character varying(8)`);
        await queryRunner.query(`ALTER TABLE "phone_number" ADD CONSTRAINT "UQ_36e77c1c34a37f612ed0952392c" UNIQUE ("outbound_interview_id")`);
        await queryRunner.query(`ALTER TABLE "phone_number" ADD CONSTRAINT "FK_88c08c11fd97e4bca93507651b1" FOREIGN KEY ("inbound_interview_id") REFERENCES "interview"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "phone_number" ADD CONSTRAINT "FK_36e77c1c34a37f612ed0952392c" FOREIGN KEY ("outbound_interview_id") REFERENCES "interview"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`UPDATE "phone_number" SET "inbound_interview_id" = "interview_id", "outbound_interview_id" = "interview_id"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP COLUMN "interview_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "phone_number" ADD "interview_id" character varying(8)`);
        await queryRunner.query(`UPDATE "phone_number" SET "interview_id" = "inbound_interview_id"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP CONSTRAINT "FK_88c08c11fd97e4bca93507651b1"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP CONSTRAINT "FK_36e77c1c34a37f612ed0952392c"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP CONSTRAINT "UQ_88c08c11fd97e4bca93507651b1"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP CONSTRAINT "UQ_36e77c1c34a37f612ed0952392c"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP COLUMN "inbound_interview_id"`);
        await queryRunner.query(`ALTER TABLE "phone_number" DROP COLUMN "outbound_interview_id"`);
    }

}
