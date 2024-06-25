import { MigrationInterface, QueryRunner } from "typeorm";

export class AuditLog1715323695657 implements MigrationInterface {
    name = 'AuditLog1715323695657'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "team_id" uuid NOT NULL, "action_type" character varying(50) NOT NULL, "resource" character varying(255) NOT NULL, "details" jsonb NOT NULL, "session_id" uuid NOT NULL, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_userid" ON "audit_logs" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_actiontype" ON "audit_logs" ("action_type") `);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_teamid_userid_actiontype" ON "audit_logs" ("team_id", "user_id", "action_type") `);
        await queryRunner.query(`CREATE INDEX "idx_audit_logs_teamid_timestamp" ON "audit_logs" ("team_id", "timestamp" DESC);`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_b818a21b2a179b77540d8205bd2" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_b818a21b2a179b77540d8205bd2"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_teamid_userid_actiontype"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_actiontype"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_userid"`);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_logs_teamid_timestamp"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
