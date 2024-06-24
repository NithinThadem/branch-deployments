import { InterviewEntity } from '../../interview/db/interview.entity'
import { IntegrationEntity } from '../../integration/db/integration.entity'
import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm'

@Entity({ name: 'trigger' })
export class TriggerEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

    @ManyToOne(() => IntegrationEntity, (integration) => integration, { onDelete: 'CASCADE', eager: true })
    @JoinColumn({ name: 'integration_id' })
    integration: IntegrationEntity

	@ManyToOne(() => InterviewEntity, (interview) => interview.responses, { onDelete: 'CASCADE', eager: true })
    @JoinColumn({ name: 'interview_id' })
	interview: InterviewEntity

	// Columns

	@Column()
	subscription_type: string

    @Column()
    name: string

	@Column({
		type: 'enum',
		enum: ['start', 'end'],
		default: 'start',
	})
	type: 'start' | 'end' = 'start'

	@Column({ name: 'metadata', type: 'jsonb', nullable: true })
	metadata: Record<string, any>

	toPublic() {
		return {
			...this,
		}
	}

}

/*
POST /triggers
{
    "integration_id": "string",
    "interview_id": "string",
    "subscription_type": "string",
    "name": "string"
}
*/
