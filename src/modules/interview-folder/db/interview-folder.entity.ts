import {
	Entity,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	OneToMany,
	JoinColumn,
	PrimaryGeneratedColumn,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'

@Entity({ name: 'interview_folder' })
export class InterviewFolderEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	@ManyToOne(() => TeamEntity, (team) => team.folders, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@OneToMany(() => InterviewEntity, (interview) => interview.folder)
	interviews: InterviewEntity[]

	@Column()
	name: string

}
