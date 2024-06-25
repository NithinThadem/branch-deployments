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
} from 'typeorm'
import { SubscriptionEntity } from '../../subscription/db/subscription.entity'
import Stripe from 'stripe'
import { PaymentEntity } from '../../payment/db/payment.entity'
import { InvoiceStatus } from './invoice.types'
import { TeamEntity } from '../../team/db/team.entity'

@Entity({ name: 'invoice' })
export class InvoiceEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => TeamEntity, team => team.invoices, { onDelete: 'CASCADE' })
	team: TeamEntity

	@ManyToOne(() => SubscriptionEntity, subscription => subscription.invoices, { onDelete: 'CASCADE' })
	subscription: SubscriptionEntity

	@OneToMany(() => PaymentEntity, payment => payment.invoice)
	payments: PaymentEntity[]

	// Columns

	@Column('decimal', { precision: 10, scale: 2 })
	amount: number

	@Column({ type: 'timestamp with time zone' })
	invoice_date: Date

	@Column({ enum: InvoiceStatus })
	status: InvoiceStatus

	@Index()
	@Column({ nullable: true, unique: true })
	stripe_invoice_id?: string

	@Column({ nullable: true, type: 'jsonb' })
	stripe_metadata?: Stripe.Invoice

	toPublic() {
		return {
			id: this.id,
			subscription: this.subscription?.toPublic(),
			payments: this.payments?.map(payment => payment.toPublic()),
			amount: this.amount,
			invoice_date: this.invoice_date,
			status: this.status,
		}
	}

}
