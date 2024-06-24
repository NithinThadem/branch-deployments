import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	Index,
	ManyToOne,
} from 'typeorm'
import { WebhookEventType } from './webhook.types'
import { UserEntity } from '../../user/db/user.entity'
import { TeamEntity } from '../../team/db/team.entity'
import { getInterviewOrFolderName } from './webhook.helpers'

@Entity({ name: 'webhook' })
@Index(['type', 'data'])
export class WebhookEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => UserEntity, user => user.webhooks, { onDelete: 'CASCADE' })
	user: UserEntity

	@ManyToOne(() => TeamEntity, team => team.webhooks, { onDelete: 'CASCADE' })
	team: TeamEntity

	// Columns

	@Column()
	type: WebhookEventType

	@Column({ nullable: true })
	data?: string

	@Column()
	url: string

	async toPublic() {
		return {
			...this,
			user: await this.user?.toPublic(),
			team: this.team?.toPublic(),
			interviewOrFolderName: await getInterviewOrFolderName(this.data),
		}
	}

}
