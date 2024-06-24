import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	Index,
	OneToMany,
} from 'typeorm'
import { WebhookEntity } from '../../webhook/db/webhook.entity'
import { ApiTokenEntity } from '../../api-token/db/api-token.entity'
import { IntegrationEntity } from '../../integration/db/integration.entity'
import { UserTeamEntity } from '../../user-team/db/user-team.entity'
import { getTeamsOfUser } from './user.helpers'
import { AuditLogEntity } from '../../audit-log/db/audit-log.entity'

@Entity({ name: 'user' })
export class UserEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@OneToMany(() => UserTeamEntity, userTeam => userTeam.user)
	user_teams: UserTeamEntity[]

	@OneToMany(() => WebhookEntity, (webhook) => webhook.user)
	webhooks: WebhookEntity[]

	@OneToMany(() => ApiTokenEntity, apiToken => apiToken.user)
	api_tokens: ApiTokenEntity[]

	@OneToMany(() => IntegrationEntity, (integration) => integration.user)
	integrations: IntegrationEntity[]

	@OneToMany(() => AuditLogEntity, auditLog => auditLog.user)
	audit_logs: AuditLogEntity[]
	// Columns

	// @Column('timestamp with time zone', { nullable: true })
	// last_login: Date

	@Column()
	@Index({ unique: true })
	email: string

	@Column({ nullable: true })
	phone_number?: string

	@Column({ nullable: true })
	first_name?: string

	@Column({ nullable: true })
	last_name?: string

	@Column({ nullable: true })
	avatar?: string

	async toPublic(roles: string[] = []) {
		return {
			...this,
			teams: await getTeamsOfUser(this.id),
			roles,
		}
	}

}
