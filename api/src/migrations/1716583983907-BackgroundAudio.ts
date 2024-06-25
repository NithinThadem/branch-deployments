import { MigrationInterface, QueryRunner } from "typeorm";

export class BackgroundAudio1716583983907 implements MigrationInterface {
    name = 'BackgroundAudio1716583983907'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Update all existing presence_background_audio values to 'call_center'
        await queryRunner.query(`UPDATE "interview" SET "presence_background_audio" = 'call_center' WHERE "presence_background_audio" IS NULL OR "presence_background_audio" = ''`);

        // Set the default value of presence_background_audio to 'call_center'
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "presence_background_audio" SET DEFAULT 'call_center'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert the default value change
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "presence_background_audio" DROP DEFAULT`);
    }
}
