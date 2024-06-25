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
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { GeniusSourceEntity } from '../../genius-source/db/genius-source.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'

@Entity({ name: 'genius' })
export class GeniusEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@Column({ name: 'team_id', nullable: true })
	team_id?: string

	@ManyToOne(() => TeamEntity, (team) => team.geniuses)
	@JoinColumn({ name: 'team_id' })
	team?: TeamEntity

	@OneToMany(() => GeniusSourceEntity, (source) => source.genius)
	sources: GeniusSourceEntity[]

	@OneToMany(() => InterviewEntity, (interview) => interview.genius)
	interviews: InterviewEntity[]

	// Columns

	@Column({ default: 'My Genius database' })
	name: string

}
