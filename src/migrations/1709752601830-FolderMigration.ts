import { MigrationInterface, QueryRunner } from "typeorm";

export class FolderMigration1709752601830 implements MigrationInterface {
    name = 'FolderMigration1709752601830'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "interview_folder" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '0', "name" character varying NOT NULL, "team_id" uuid, CONSTRAINT "PK_322db9ea2905a9ea99005daec19" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "interview" ADD "folder_id" uuid`);
        await queryRunner.query(`ALTER TABLE "interview_folder" ADD CONSTRAINT "FK_650d1fdb12b8b5014d93e11dd88" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "interview" ADD CONSTRAINT "FK_322db9ea2905a9ea99005daec19" FOREIGN KEY ("folder_id") REFERENCES "interview_folder"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "interview" DROP CONSTRAINT "FK_322db9ea2905a9ea99005daec19"`);
        await queryRunner.query(`ALTER TABLE "interview_folder" DROP CONSTRAINT "FK_650d1fdb12b8b5014d93e11dd88"`);
        await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "folder_id"`);
        await queryRunner.query(`DROP TABLE "interview_folder"`);
    }

}
