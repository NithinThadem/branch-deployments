import { MigrationInterface, QueryRunner } from "typeorm";

export class Webhooks1704924434387 implements MigrationInterface {
    name = 'Webhooks1704924434387'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "webhook" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "type" character varying NOT NULL, "data" character varying, "url" character varying NOT NULL, "user_id" uuid, CONSTRAINT "PK_e6765510c2d078db49632b59020" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_78bfce1819c44b3cc3db1a3b64" ON "webhook" ("type", "data") `);
        await queryRunner.query(`ALTER TABLE "webhook" ADD CONSTRAINT "FK_b0dcfcc8c95edc2232ea8e97710" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "webhook" DROP CONSTRAINT "FK_b0dcfcc8c95edc2232ea8e97710"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_78bfce1819c44b3cc3db1a3b64"`);
        await queryRunner.query(`DROP TABLE "webhook"`);
    }

}
