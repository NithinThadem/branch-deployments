import { MigrationInterface, QueryRunner } from "typeorm";

export class DataDashboard1707748736694 implements MigrationInterface {
    name = 'DataDashboard1707748736694'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_point" DROP CONSTRAINT "FK_8f3ed3370b55ef91be3dfeb3a44"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP CONSTRAINT "FK_33b16b71c6a7db11b4437e36596"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "team_id" character varying`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "response_type" character varying NOT NULL DEFAULT 'BROWSER_CALL'`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "interview_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "interview_id" character varying`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "response_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "response_id" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "response_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "response_id" uuid`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "interview_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD "interview_id" character varying(8)`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "response_type"`);
        await queryRunner.query(`ALTER TABLE "data_point" DROP COLUMN "team_id"`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD CONSTRAINT "FK_33b16b71c6a7db11b4437e36596" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "data_point" ADD CONSTRAINT "FK_8f3ed3370b55ef91be3dfeb3a44" FOREIGN KEY ("response_id") REFERENCES "interview_response"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
