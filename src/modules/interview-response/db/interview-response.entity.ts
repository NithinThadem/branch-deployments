import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	OneToMany,
	Index,
	JoinColumn,
} from 'typeorm'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { InterviewDeliverableEntity } from '../../interview-deliverable/db/interview-deliverable.entity'
import {
	ConversationHistory,
	InterviewResponseMetadata,
	InterviewResponseStatus,
	InterviewResponseType,
	SummaryData,
	TriggeredMetadata,
} from './interview-response.types'
import { ContactEntity } from '../../contact/db/contact.entity'
import { JobEntity } from '../../job/db/job.entity'
import { TeamEntity } from '../../team/db/team.entity'
import { formatTranscript } from '../api/interview-response.helpers'

@Entity({ name: 'interview_response' })
export class InterviewResponseEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => InterviewEntity, (interview) => interview.responses, { onDelete: 'CASCADE', eager: true })
	interview: InterviewEntity

	@OneToMany(() => InterviewDeliverableEntity, (deliverable) => deliverable.interview_response, { onDelete: 'CASCADE' })
	deliverables: InterviewDeliverableEntity[]

	@ManyToOne(
		() => ContactEntity,
		(contact) => contact.interview_responses,
		{ onDelete: 'SET NULL', nullable: true, eager: true }
	)
	contact?: ContactEntity

	@ManyToOne(() => JobEntity, (job) => job.responses, { onDelete: 'CASCADE', nullable: true })
	job?: JobEntity

	@Column({ name: 'team_id' })
	team_id: string

	@ManyToOne(() => TeamEntity, (team) => team.responses, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	// Columns

	@Column({ enum: InterviewResponseType, default: InterviewResponseType.BROWSER_CALL })
	type: InterviewResponseType

	@Column({ enum: InterviewResponseStatus, default: InterviewResponseStatus.NOT_STARTED })
	status: InterviewResponseStatus

	@Column({ nullable: true, type: 'timestamp with time zone' })
	start_time?: Date

	@Column({ nullable: true, type: 'timestamp with time zone' })
	end_time?: Date

	@Column({ default: 0, type: 'bigint' })
	duration_ms: number

	@Column({ type: 'jsonb', default: '[]' })
	conversation_history: ConversationHistory[]

	@Column({ nullable: true })
	error_id?: string

	@Column()
	ai_name: string

	@Index()
	@Column({ unique: true, nullable: true })
	twilio_sid: string

	@Column({ nullable: true })
	phone_number?: string

	@Column({ nullable: true })
	recording_url?: string

	@Column({ type: 'jsonb', nullable: true })
	summary_data?: SummaryData

	@Column({ type: 'jsonb', nullable: true })
	metadata: InterviewResponseMetadata

	@Column({ type: 'jsonb', nullable: true })
	triggered_metadata?: TriggeredMetadata

	@Column({ nullable: true })
	call_failure_reason?: string

	toPublic() {
		return {
			id: this.id,
			created: this.created,
			updated: this.updated,
			version: this.version,
			interview: this.interview?.toPublic(),
			deliverables: this.deliverables?.map((deliverable) => deliverable.toPublic()),
			contact: this.contact?.toPublic(),
			job: this.job?.toPublic(),
			team: this.team?.toPublic(),
			type: this.type,
			status: this.status,
			start_time: this.start_time,
			end_time: this.end_time,
			duration_ms: this.duration_ms,
			conversation_history: this.conversation_history?.filter((message) => message.author !== 'system'),
			ai_name: this.ai_name,
			phone_number: this.phone_number,
			recording_url: this.recording_url,
			transcript: formatTranscript(this),
			summary_data: this.summary_data,
			metadata: this.metadata,
			triggered_metadata: this.triggered_metadata,
			call_failure_reason: this.call_failure_reason,
		}
	}

}
