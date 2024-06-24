import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm'
import { PhoneNumberEntity } from '../../phone_number/db/phone_number.entity'
import { TeamEntity } from '../../team/db/team.entity'
import { TwilioSmsMessage } from './sms-message.types'

@Entity({ name: 'sms_message' })
export class SmsMessageEntity extends BaseEntity {

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

	@ManyToOne(() => TeamEntity, (team) => team.sms_messages, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@Column({ name: 'phone_number_id' })
	phone_number_id: string

	@ManyToOne(() => PhoneNumberEntity, (phoneNumber) => phoneNumber.sms_messages, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'phone_number_id' })
	phone_number: PhoneNumberEntity

	// Columns

	@Column()
	status: string

	@Column()
	twilio_sid: string

	@Column()
	body: string

	@Column()
	from: string

	@Column()
	to: string

	@Column({ nullable: true, type: 'jsonb' })
	twilio_metadata: TwilioSmsMessage

}
