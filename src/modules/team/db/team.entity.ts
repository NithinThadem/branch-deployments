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
import { SubscriptionEntity } from '../../subscription/db/subscription.entity'
import { PaymentEntity } from '../../payment/db/payment.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { InvoiceEntity } from '../../invoice/db/invoice.entity'
import Stripe from 'stripe'
import { ContactEntity } from '../../contact/db/contact.entity'
import { JobEntity } from '../../job/db/job.entity'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { getTeamAllowedMinutes, getTeamUsedMinutes } from '../../subscription/db/subscription.helpers'
import { PhoneNumberEntity } from '../../phone_number/db/phone_number.entity'
import { GeniusEntity } from '../../genius/db/genius.entity'
import { ApiTokenEntity } from '../../api-token/db/api-token.entity'
import { WebhookEntity } from '../../webhook/db/webhook.entity'
import { UsageEntity } from '../../usage/db/usage.entity'
import { InterviewFolderEntity } from '../../interview-folder/db/interview-folder.entity'
import { TeamBusinessMetadata, TeamTwilioMetadata } from './team.types'
import { IntegrationEntity } from '../../integration/db/integration.entity'
import { SmsMessageEntity } from '../../sms-message/db/sms-message.entity'
import { UserTeamEntity } from '../../user-team/db/user-team.entity'
import { getUsersOfTeam } from '../api/team.helpers'
import { AuditLogEntity } from '../../audit-log/db/audit-log.entity'
import { CallerIdEntity } from '../../caller-id/db/caller-id.entity'

@Entity({ name: 'team' })
export class TeamEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@OneToMany(() => SubscriptionEntity, (subscription) => subscription.team, { eager: true })
	subscriptions: SubscriptionEntity[]

	@OneToMany(() => PaymentEntity, (payment) => payment.team)
	payments: PaymentEntity[]

	@OneToMany(() => InvoiceEntity, (invoice) => invoice.team)
	invoices: InvoiceEntity[]

	@OneToMany(() => InterviewEntity, (interview) => interview.team)
	interviews: InterviewEntity[]

	@OneToMany(() => UserTeamEntity, userTeam => userTeam.team)
	user_teams: UserTeamEntity[]

	@OneToMany(() => ContactEntity, (contact) => contact.team)
	contacts: ContactEntity[]

	@OneToMany(() => JobEntity, (job) => job.team)
	jobs: JobEntity[]

	@OneToMany(() => InterviewResponseEntity, (interviewResponse) => interviewResponse.team)
	responses: InterviewResponseEntity[]

	@OneToMany(() => PhoneNumberEntity, (phoneNumber) => phoneNumber.team)
	phone_numbers: PhoneNumberEntity[]

	@OneToMany(() => GeniusEntity, (genius) => genius.team)
	geniuses: GeniusEntity[]

	@OneToMany(() => ApiTokenEntity, apiToken => apiToken.team)
	api_tokens: ApiTokenEntity[]

	@OneToMany(() => WebhookEntity, (webhook) => webhook.team)
	webhooks: WebhookEntity[]

	@OneToMany(() => UsageEntity, (usage) => usage.team)
	usage: UsageEntity[]

	@OneToMany(() => InterviewFolderEntity, (folder) => folder.team)
	folders: InterviewFolderEntity[]

	@OneToMany(() => IntegrationEntity, (integration) => integration.team)
	integrations: IntegrationEntity[]

	@OneToMany(() => SmsMessageEntity, (smsMessage) => smsMessage.team)
	sms_messages: SmsMessageEntity[]

	@OneToMany(() => AuditLogEntity, auditLog => auditLog.team)
	audit_logs: AuditLogEntity[]

	@OneToMany(() => CallerIdEntity, (callerId) => callerId.team)
	caller_ids: CallerIdEntity[]

	// Columns

	@Column({ nullable: true })
	name?: string

	@Column({ nullable: true })
	name_pronunciation?: string

	@Index()
	@Column({ nullable: true, unique: true })
	stripe_customer_id?: string

	@Column({ nullable: true, type: 'jsonb' })
	stripe_metadata?: Stripe.Customer

	@Column({ nullable: true })
	logo_url?: string

	@Column({ type: 'jsonb', default: {} })
	business_metadata: TeamBusinessMetadata

	@Column({ nullable: true })
	twilio_account_sid?: string

	@Column({ nullable: true })
	twilio_account_secret?: string // TODO encrypt

	@Column({ type: 'jsonb', default: {} })
	twilio_metadata: Partial<TeamTwilioMetadata>

	@Column({ type: 'jsonb', default: [] })
	contact_views: { name: string, attribute_keys: string[] }[]

	async toPublic() {
		const users = await getUsersOfTeam(this.id)
		const user_emails = users ? users.map(user => user.email) : []
		const subscriptions = this.subscriptions?.map(subscription => ({
			id: subscription.id,
			plan: subscription.plan,
			status: subscription.status,
			// TODO: fix stripe types
			amount: Number((subscription.stripe_metadata as any)?.plan?.amount ?? 0),
			quantity: subscription.quantity,
		}))

		return {
			...this,
			users,
			allowed_minutes: getTeamAllowedMinutes(this),
			used_minutes: await getTeamUsedMinutes(this),
			stripe_metadata: undefined,
			stripe_customer_id: undefined,
			subscriptions,
			user_emails,
		}
	}

}
