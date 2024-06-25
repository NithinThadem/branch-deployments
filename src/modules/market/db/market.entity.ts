import { InterviewEntity } from '../../../modules/interview/db/interview.entity'
import {
	BaseEntity, Column, CreateDateColumn, Entity, JoinColumn, OneToOne,
	PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn,
} from 'typeorm'

@Entity({ name: 'market' })
export class MarketEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@OneToOne(() => InterviewEntity, (interview) => interview.market, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'interview_id' })
	interview: InterviewEntity

	// Columns

	@Column({ type: 'text' })
	listing_name: string

	@Column({ type: 'text', default: '' })
	description: string

	@Column('text', { array: true, nullable: true, default: () => 'array[]::text[]' })
	tags: string[]

	@Column({ type: 'bigint', default: 0 })
	price: number

	@Column({ type: 'text', nullable: true })
	image_url?: string

	@Column({ type: 'text', nullable: true })
	demo_url?: string

	toPublic() {
		return {
			id: this.id,
			created: this.created,
			updated: this.updated,
			version: this.version,
			interview: this.interview,
			listing_name: this.listing_name,
			description: this.description,
			tags: this.tags,
			price: this.price,
			image_url: this.image_url,
			demo_url: this.demo_url,
		}
	}

}
