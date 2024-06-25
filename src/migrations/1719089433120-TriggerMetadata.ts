import { MigrationInterface, QueryRunner } from "typeorm";

export class TriggerMetadata1719089433120 implements MigrationInterface {
    name = 'TriggerMetadata1719089433120'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trigger" ADD "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trigger" DROP COLUMN "metadata"`);
    }

}
