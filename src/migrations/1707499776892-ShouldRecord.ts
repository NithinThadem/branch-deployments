import { MigrationInterface, QueryRunner } from "typeorm";

export class ShouldRecord1707499776892 implements MigrationInterface {
    name = 'ShouldRecord1707499776892'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ADD "should_record" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT array[]::text[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT ARRAY[]`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "should_record"`);
    }

}
