import { MigrationInterface, QueryRunner } from "typeorm";

export class UsageSetNull1716504674598 implements MigrationInterface {
    name = 'UsageSetNull1716504674598'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_f45eeebcc415df051b8913aa904"`);
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3"`);
        await queryRunner.query(`ALTER TABLE "usage" ALTER COLUMN "interview_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usage" ALTER COLUMN "team_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_f45eeebcc415df051b8913aa904" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_f45eeebcc415df051b8913aa904"`);
        await queryRunner.query(`ALTER TABLE "usage" DROP CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3"`);
        await queryRunner.query(`ALTER TABLE "usage" ALTER COLUMN "team_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usage" ALTER COLUMN "interview_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_91a71ceebccc5395a6d2a1263c3" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usage" ADD CONSTRAINT "FK_f45eeebcc415df051b8913aa904" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
