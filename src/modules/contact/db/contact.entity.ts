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
	Unique,
	ManyToMany,
	JoinTable,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { ContactStatus, LeadSourceTypes } from './contact.types'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { JobEntity } from '../../job/db/job.entity'
import { ContactTagEntity } from '../../contact-tag/db/contact-tag.entity'

@Entity({ name: 'contact' })
@Unique(['team_id', 'phone_number'])
export class ContactEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, (team) => team.contacts, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'team_id' })
	team?: TeamEntity

	@OneToMany(() => InterviewResponseEntity, (interviewResponse) => interviewResponse.contact)
	interview_responses: InterviewResponseEntity[]

	@ManyToMany(() => JobEntity, job => job.contacts, { onDelete: 'CASCADE' })
	@JoinTable({ name: 'job_contacts' })
	jobs: JobEntity[]

	@ManyToMany(() => ContactTagEntity, tag => tag.contacts, { cascade: true })
	@JoinTable({
		name: 'contact_tags',
		joinColumn: { name: 'contact_id', referencedColumnName: 'id' },
		inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
	})
	tags: ContactTagEntity[]

	// Columns

	@Column({ enum: ContactStatus, default: ContactStatus.ACTIVE })
	status: ContactStatus

	@Column({ nullable: true, default: '' })
	name: string

	@Column({ nullable: true })
	caller_type?: string

	@Column({ nullable: true })
	phone_number?: string

	@Column({ nullable: true })
	email?: string

	@Column({ type: 'jsonb', nullable: true })
	attributes: Record<string, string>

	@Column({ nullable: true })
	lead_source?: LeadSourceTypes

	toPublic() {
		return {
			id: this.id,
			created: this.created,
			updated: this.updated,
			version: this.version,
			team_id: this.team_id,
			status: this.status,
			name: this.name,
			caller_type: this.caller_type,
			phone_number: this.phone_number,
			email: this.email,
			attributes: this.attributes,
			tags: this.tags?.map(tag => tag.name) || [],
			lead_source: this.lead_source,
		}
	}

}
