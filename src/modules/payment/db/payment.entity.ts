import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	VersionColumn,
	Index,
} from 'typeorm'
import { PaymentStatus } from './payment.types'
import Stripe from 'stripe'
import { InvoiceEntity } from '../../invoice/db/invoice.entity'
import { TeamEntity } from '../../team/db/team.entity'

@Entity({ name: 'payment' })
export class PaymentEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => TeamEntity, team => team.payments, { onDelete: 'CASCADE' })
	team: TeamEntity

	@ManyToOne(() => InvoiceEntity, invoice => invoice.payments, { onDelete: 'CASCADE' })
	invoice: InvoiceEntity

	// Columns

	@Column('decimal', { precision: 10, scale: 2 })
	amount: number

	@Column({ type: 'timestamp with time zone' })
	payment_date: Date

	@Column({ enum: PaymentStatus })
	status: PaymentStatus

	@Index()
	@Column({ nullable: true, unique: true })
	stripe_payment_id?: string

	@Column({ nullable: true, type: 'jsonb' })
	stripe_metadata?: Stripe.PaymentIntent

	toPublic() {
		return {
			id: this.id,
			invoice: this.invoice?.toPublic(),
			amount: this.amount,
			payment_date: this.payment_date,
			status: this.status,
		}
	}

}
