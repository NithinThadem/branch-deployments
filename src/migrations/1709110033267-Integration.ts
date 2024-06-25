import { MigrationInterface, QueryRunner } from "typeorm";

export class Integration1709110033267 implements MigrationInterface {
    name = 'Integration1709110033267'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "integration" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "team_id" uuid NOT NULL, "user_id" uuid NOT NULL, "slug" character varying NOT NULL, "api_type" character varying NOT NULL, "auth_metadata" jsonb NOT NULL, CONSTRAINT "PK_f348d4694945d9dc4c7049a178a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT array[]::text[]`);
        await queryRunner.query(`ALTER TABLE "integration" ADD CONSTRAINT "FK_562e8940dd0a318425154d8fd75" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "integration" ADD CONSTRAINT "FK_68a2ec8d07dd827da8d67d6560e" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integration" DROP CONSTRAINT "FK_68a2ec8d07dd827da8d67d6560e"`);
        await queryRunner.query(`ALTER TABLE "integration" DROP CONSTRAINT "FK_562e8940dd0a318425154d8fd75"`);
        await queryRunner.query(`ALTER TABLE "interview" ALTER COLUMN "response_tags" SET DEFAULT ARRAY[]`);
        await queryRunner.query(`DROP TABLE "integration"`);
    }

}
