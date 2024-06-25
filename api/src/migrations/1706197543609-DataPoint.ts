import { MigrationInterface, QueryRunner } from "typeorm";

export class DataPoint1706197543609 implements MigrationInterface {
    name = 'DataPoint1706197543609'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_point" DROP CONSTRAINT "UQ_c64580391d4e5234a9186bcb4b4"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "answer"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "question_number"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "type" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "value" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "node_id" character varying`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "value_type" character varying`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "metadata" jsonb`);
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT array[]::text[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT ARRAY[]`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "value_type"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "node_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "value"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "question_number" integer NOT NULL`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "answer" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD CONSTRAINT "UQ_c64580391d4e5234a9186bcb4b4" UNIQUE ("response_id", "question_number")`);
    }

}
