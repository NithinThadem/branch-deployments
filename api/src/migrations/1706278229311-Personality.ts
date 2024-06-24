import { MigrationInterface, QueryRunner } from "typeorm";

export class Personality1706278229311 implements MigrationInterface {
    name = 'Personality1706278229311'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" ADD "personality_customization" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "personality_customization"`);
    }

}
