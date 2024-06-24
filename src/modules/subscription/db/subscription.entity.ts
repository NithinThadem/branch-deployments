import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	VersionColumn,
	OneToMany,
	Index,
	OneToOne,
	JoinColumn,
} from 'typeorm'
import { SubscriptionPlans, SubscriptionStatus } from './subscription.types'
import { InvoiceEntity } from '../../invoice/db/invoice.entity'
import Stripe from 'stripe'
import { TeamEntity } from '../../team/db/team.entity'
import { PhoneNumberEntity } from '../../phone_number/db/phone_number.entity'

@Entity({ name: 'subscription' })
export class SubscriptionEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, team => team.subscriptions, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@OneToMany(() => InvoiceEntity, invoice => invoice.subscription)
	invoices: InvoiceEntity[]

	@OneToOne(() => PhoneNumberEntity, phone_number => phone_number.subscription, { onDelete: 'SET NULL' })
	phone_number: PhoneNumberEntity

	// Columns

	@Column({ enum: SubscriptionPlans, default: SubscriptionPlans.BASIC })
	plan: SubscriptionPlans

	@Column({ type: 'timestamp with time zone' })
	start_date: Date

	@Column({ default: 1 })
	quantity: number

	@Column({ enum: SubscriptionStatus })
	status: SubscriptionStatus

	@Index()
	@Column({ nullable: true, unique: true })
	stripe_subscription_id?: string

	@Column({ nullable: true, type: 'jsonb' })
	stripe_metadata?: Stripe.Subscription

	toPublic() {
		return {
			id: this.id,
			invoices: this.invoices?.map(invoice => invoice.toPublic()),
			start_date: this.start_date,
			status: this.status,
			plan: this.plan,
		}
	}

}
