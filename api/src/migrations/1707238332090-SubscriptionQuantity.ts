import { MigrationInterface, QueryRunner } from "typeorm";

export class SubscriptionQuantity1707238332090 implements MigrationInterface {
    name = 'SubscriptionQuantity1707238332090'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscription" ADD "quantity" integer NOT NULL DEFAULT '1'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscription" DROP COLUMN "quantity"`);
    }

}
