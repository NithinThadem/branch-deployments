import { MigrationInterface, QueryRunner } from "typeorm";

export class ContactAttributes1710880402374 implements MigrationInterface {
    name = 'ContactAttributes1710880402374'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" ADD "attributes" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP COLUMN "attributes"`);
    }

}
