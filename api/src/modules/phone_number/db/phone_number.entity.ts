import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	OneToOne,
	JoinColumn,
	OneToMany,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { PhoneNumberType } from './phone_number.types'
import { SubscriptionEntity } from '../../subscription/db/subscription.entity'
import { SmsMessageEntity } from '../../sms-message/db/sms-message.entity'

@Entity({ name: 'phone_number' })
export class PhoneNumberEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, (team) => team.phone_numbers, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@Column({ name: 'inbound_interview_id', nullable: true })
	inbound_interview_id?: string

	@OneToOne(() => InterviewEntity)
	@JoinColumn({ name: 'inbound_interview_id' })
	inbound_interview: InterviewEntity

	@Column({ name: 'outbound_interview_id', nullable: true })
	outbound_interview_id?: string

	@OneToOne(() => InterviewEntity)
	@JoinColumn({ name: 'outbound_interview_id' })
	outbound_interview: InterviewEntity

	@OneToOne(() => SubscriptionEntity, (subscription) => subscription.phone_number, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'subscription_id' })
	subscription: SubscriptionEntity

	@OneToMany(() => SmsMessageEntity, (smsMessage) => smsMessage.phone_number)
	sms_messages: SmsMessageEntity[]

	// Columns

	@Column()
	phone_number: string

	@Column({ enum: PhoneNumberType, default: PhoneNumberType.TOLL_FREE })
	type: PhoneNumberType

	@Column()
	twilio_sid: string

}
