import { MigrationInterface, QueryRunner } from "typeorm";

export class UserTeams1714067052644 implements MigrationInterface {
    name = 'UserTeams1714067052644'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_teams" DROP CONSTRAINT "FK_ee838ec2b13ac600a162c20ce33"`);
        await queryRunner.query(`ALTER TABLE "user_teams" DROP CONSTRAINT "FK_006715ef1e1b40852f379efe567"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee838ec2b13ac600a162c20ce3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_006715ef1e1b40852f379efe56"`);
        await queryRunner.query(`ALTER TABLE "user_teams" ADD "status" character varying NOT NULL DEFAULT 'ACTIVE'`);
        await queryRunner.query(`ALTER TABLE "user_teams" ADD CONSTRAINT "FK_ee838ec2b13ac600a162c20ce33" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_teams" ADD CONSTRAINT "FK_006715ef1e1b40852f379efe567" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_teams" DROP CONSTRAINT "FK_006715ef1e1b40852f379efe567"`);
        await queryRunner.query(`ALTER TABLE "user_teams" DROP CONSTRAINT "FK_ee838ec2b13ac600a162c20ce33"`);
        await queryRunner.query(`ALTER TABLE "user_teams" DROP COLUMN "status"`);
        await queryRunner.query(`CREATE INDEX "IDX_006715ef1e1b40852f379efe56" ON "user_teams" ("team_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ee838ec2b13ac600a162c20ce3" ON "user_teams" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "user_teams" ADD CONSTRAINT "FK_006715ef1e1b40852f379efe567" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_teams" ADD CONSTRAINT "FK_ee838ec2b13ac600a162c20ce33" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

}
