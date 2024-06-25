import { MigrationInterface, QueryRunner } from "typeorm";

export class Usage1707221761214 implements MigrationInterface {
    name = 'ChangeMe1707221761214'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "interview_id" character varying NOT NULL, "team_id" uuid NOT NULL, "type" character varying NOT NULL, "quantity_ms" integer NOT NULL, CONSTRAINT "PK_7bc33e71ab6c3b71eac72950b44" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_f45eeebcc415df051b8913aa904" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_f45eeebcc415df051b8913aa904"`);
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3"`);
        await queryRunner.query(`DROP TABLE "usage"`);
    }

}
