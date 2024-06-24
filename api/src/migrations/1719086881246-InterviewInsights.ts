import { MigrationInterface, QueryRunner } from "typeorm";

export class InterviewInsights1719086881246 implements MigrationInterface {
	name = 'InterviewInsights1719086881246'

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
            ALTER TABLE "interview" ADD "metrics" jsonb DEFAULT '[
                {
                    "icon": "phone",
                    "color": "#0000FF",
                    "description": "Total Responses",
                    "value": "TOTAL_RESPONSES",
                    "type": "status",
                    "method": "sum"
                },
                {
                    "icon": "user_check",
                    "color": "#FF0000",
                    "description": "Ended Responses",
                    "value": "ENDED",
                    "type": "status",
                    "method": "sum"
                },
                {
                    "icon": "phone_missed",
                    "color": "#808080",
                    "description": "No Answer Responses",
                    "value": "NO_ANSWER",
                    "type": "status",
                    "method": "sum"
                },
                {
                    "icon": "clock",
                    "color": "#00FF00",
                    "description": "Pickup Rate",
                    "value": "PICKUP_RATE",
                    "type": "status",
                    "method": "percentage",
                    "base": "TOTAL_RESPONSES"
                },
                {
                    "icon": "repeat",
                    "color": "#800080",
                    "description": "Transfer Rate",
                    "value": "TRANSFERRED",
                    "type": "status",
                    "method": "percentage",
                    "base": "TOTAL_RESPONSES"
                }
            ]'::jsonb
        `);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "interview" DROP COLUMN "metrics"`);
	}
}