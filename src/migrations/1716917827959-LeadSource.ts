import { MigrationInterface, QueryRunner } from "typeorm";

export class LeadSource1716917827959 implements MigrationInterface {
    name = 'LeadSource1716917827959'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" ADD "lead_source" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP COLUMN "lead_source"`);
    }

}
