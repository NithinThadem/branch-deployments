import { MigrationInterface, QueryRunner } from "typeorm";

export class WebhookTeamRelation1705699822996 implements MigrationInterface {
    name = 'WebhookTeamRelation1705699822996'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "webhook" ADD "team_id" uuid`);
        await queryRunner.query(`ALTER TABLE "webhook" ADD CONSTRAINT "FK_3be3e7ff34909384915b9fe8c70" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "webhook" DROP CONSTRAINT "FK_3be3e7ff34909384915b9fe8c70"`);
        await queryRunner.query(`ALTER TABLE "webhook" DROP COLUMN "team_id"`);
    }

}
