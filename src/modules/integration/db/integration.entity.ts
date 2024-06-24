import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	VersionColumn,
	JoinColumn,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { UserEntity } from '../../user/db/user.entity'
import { IntegrationApiType, IntegrationAuthMetadata } from './integration.types'

@Entity({ name: 'integration' })
export class IntegrationEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, team => team.integrations, { onDelete: 'CASCADE', eager: true })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@Column({ name: 'user_id' })
	user_id: string

	@ManyToOne(() => UserEntity, user => user.integrations, { onDelete: 'CASCADE', eager: true })
	@JoinColumn({ name: 'user_id' })
	user: UserEntity

	@Column()
	slug: string

	@Column()
	api_type: IntegrationApiType

	@Column({ type: 'jsonb' })
	auth_metadata: IntegrationAuthMetadata

	toPublic() {
		return {
			...this,
			auth_metadata: undefined,
		}
	}

}
