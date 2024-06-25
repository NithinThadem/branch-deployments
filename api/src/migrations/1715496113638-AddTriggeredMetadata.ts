import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInterviewTriggeredMetadata1715496113638
	implements MigrationInterface
{
	name = "AddInterviewTriggeredMetadata1715496113638";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "interview_response" ADD "triggered_metadata" jsonb`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "interview_response" DROP COLUMN "triggered_metadata"`
		);
	}
}
