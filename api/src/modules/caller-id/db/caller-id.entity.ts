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
	OneToMany,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'

@Entity({ name: 'caller_id' })
export class CallerIdEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, (team) => team.phone_numbers, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@OneToMany(() => InterviewEntity, (interview) => interview.caller_id, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'interview_id' })
	interviews: InterviewEntity[]

	// Columns

	@Column()
	phone_number: string

	@Column({ nullable: true })
	twilio_sid?: string

}
