import {
	Entity,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	JoinColumn,
	PrimaryGeneratedColumn,
	OneToMany,
	ManyToMany,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { ContactEntity } from '../../contact/db/contact.entity'
import {
	JobLog, JobStatus, JobType, RddConfig,
} from './job.types'
import { InterviewEntity } from '../../interview/db/interview.entity'
import logger from '../../../util/logger.util'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { dbSubscriber } from '../../../services/database/db-subscriber'

@Entity({ name: 'job' })
export class JobEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@Column({ name: 'team_id' })
	team_id: string

	@ManyToOne(() => TeamEntity, (team) => team.jobs, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@Column({ name: 'interview_id', nullable: true })
	interview_id?: string

	@ManyToOne(() => InterviewEntity, (interview) => interview.jobs, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'interview_id' })
	interview?: InterviewEntity

	@ManyToMany(() => ContactEntity, (contact) => contact.jobs, { onDelete: 'SET NULL' })
	contacts: ContactEntity[]

	@OneToMany(
		() => InterviewResponseEntity,
		(interviewResponse) => interviewResponse.job,
		{ onDelete: 'CASCADE', nullable: true }
	)
	responses?: InterviewResponseEntity[]

	// Columns

	@Column({ enum: JobType, default: JobType.CONTACTS })
	type: JobType

	@Column({ nullable: true, type: 'jsonb' })
	rdd_config?: RddConfig

	@Column({ enum: JobStatus, default: JobStatus.NOT_STARTED })
	status: JobStatus

	@Column({ nullable: true })
	note?: string

	@Column({ type: 'jsonb', default: [] })
	logs: JobLog[]

	appendLog(text: string, type: 'error' | 'info' | 'warn' = 'info') {
		logger.info(`Job ${this.id}: ${text}`)
		const log = JSON.stringify({ created: new Date(), text, type })

		return Promise.all([
			JobEntity.query(
				`UPDATE job
				SET logs = logs || $1
				WHERE id = $2`,
				[log, this.id]
			),
			dbSubscriber.notify(`job:${this.id}`, log),
		])
	}

	toPublic() {
		return {
			id: this.id,
			type: this.type,
			status: this.status,
		}
	}

}
