import { MigrationInterface, QueryRunner } from "typeorm";

export class ApiToken1705685169524 implements MigrationInterface {
    name = 'ApiToken1705685169524'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "api_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "token" character varying NOT NULL, "team_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_d862311c568d175c26f41bc6f98" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "api_token" ADD CONSTRAINT "FK_e5d8f4ce25e0e568f3c1a069f44" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_token" ADD CONSTRAINT "FK_1725c5ea908ff009f6ab3fa34fd" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_token" DROP CONSTRAINT "FK_1725c5ea908ff009f6ab3fa34fd"`);
        await queryRunner.query(`ALTER TABLE "api_token" DROP CONSTRAINT "FK_e5d8f4ce25e0e568f3c1a069f44"`);
        await queryRunner.query(`DROP TABLE "api_token"`);
    }

}
