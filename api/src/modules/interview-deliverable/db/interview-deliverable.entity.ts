import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
} from 'typeorm'
import { InterviewDeliverableType, Pov } from './interview-deliverable.types'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'

@Entity({ name: 'interview_deliverable' })
export class InterviewDeliverableEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => InterviewResponseEntity, (interview) => interview.deliverables, { onDelete: 'CASCADE' })
	interview_response: InterviewResponseEntity

	// Columns

	@Column({ enum: InterviewDeliverableType })
	type: InterviewDeliverableType

	@Column({ nullable: true })
	video_url?: string

	@Column({ nullable: true })
	audio_url?: string

	@Column({ nullable: true })
	thumbnail_url?: string

	@Column({ nullable: true, type: 'text', array: true })
	image_urls?: string[]

	@Column({ nullable: true })
	title?: string

	@Column({ nullable: true })
	content?: string

	@Column({ nullable: true })
	length_seconds?: number

	@Column({ enum: Pov, nullable: true })
	pov: Pov

	toPublic() {
		return {
			id: this.id,
		}
	}

}
