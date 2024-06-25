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
import { InterviewEntity } from '../../interview/db/interview.entity'
import { UsageType } from './usage.types'
import { TeamEntity } from '../../team/db/team.entity'

@Entity({ name: 'usage' })
export class UsageEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => InterviewEntity, (interview) => interview.usage, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'interview_id' })
	interview: InterviewEntity

	@Column({ name: 'interview_id', nullable: true })
	interview_id: string

	@ManyToOne(() => TeamEntity, (team) => team.usage, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@Column({ name: 'team_id', nullable: true })
	team_id: string

	// Columns

	@Column()
	type: UsageType

	@Column()
	quantity_ms: number

}
