import { MigrationInterface, QueryRunner } from "typeorm";

export class Lang1703885795094 implements MigrationInterface {
    name = 'Lang1703885795094'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "lang"`);
        await queryRunner.query(`DROP TYPE "public"."interview_lang_enum"`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "lang" character varying NOT NULL DEFAULT 'en'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "lang"`);
        await queryRunner.query(`CREATE TYPE "public"."interview_lang_enum" AS ENUM('en', 'es', 'it', 'de')`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "lang" "public"."interview_lang_enum" NOT NULL DEFAULT 'en'`);
    }

}
