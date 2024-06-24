import {
	Entity,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	OneToMany,
	PrimaryColumn,
	BeforeInsert,
	JoinColumn,
	OneToOne,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { generateShortString } from '../../../util/helpers.util'
import {
	InterviewLanguage,
	InterviewStatus,
	InterviewType,
	MetricDetails,
	PersonalityCustomization,
	PresenceBackgroundAudio,
	PresenceInterimAudio,
} from './interview.types'
import { JobEntity } from '../../job/db/job.entity'
import { InterviewFlowEntity } from '../../interview-flow/db/interview-flow.entity'
import { PhoneNumberEntity } from '../../phone_number/db/phone_number.entity'
import { GeniusEntity } from '../../genius/db/genius.entity'
import { MarketEntity } from '../../../modules/market/db/market.entity'
import { UsageEntity } from '../../usage/db/usage.entity'
import { InterviewFolderEntity } from '../../interview-folder/db/interview-folder.entity'
import { CallerIdEntity } from '../../caller-id/db/caller-id.entity'

@Entity({ name: 'interview' })
export class InterviewEntity extends BaseEntity {

	@PrimaryColumn('varchar', { length: '8' })
	id: string

	@BeforeInsert()
	private beforeInsert() {
		this.id = generateShortString(8) // 218 trillion unique
	}

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@Column({ name: 'team_id' })
	team_id: string

	@ManyToOne(() => TeamEntity, (team) => team.interviews, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

	@OneToMany(() => InterviewResponseEntity, (interview_response) => interview_response.interview)
	responses: InterviewResponseEntity[]

	@OneToMany(() => JobEntity, (job) => job.interview)
	jobs: JobEntity[]

	@OneToOne(() => InterviewFlowEntity, (flow) => flow.interview, { onDelete: 'CASCADE' })
	flow: InterviewFlowEntity

	@OneToOne(() => PhoneNumberEntity, phoneNumber => phoneNumber.inbound_interview)
	inbound_phone_number?: PhoneNumberEntity

	@OneToOne(() => PhoneNumberEntity, phoneNumber => phoneNumber.outbound_interview)
	outbound_phone_number?: PhoneNumberEntity

	@Column({ name: 'caller_id_id', nullable: true })
	caller_id_id?: string

	@ManyToOne(() => CallerIdEntity, callerId => callerId.interviews, { onDelete: 'SET NULL' })
	caller_id?: CallerIdEntity

	@OneToOne(() => MarketEntity, (market) => market.interview, { nullable: true, onDelete: 'SET NULL' })
	market?: MarketEntity

	@Column({ name: 'genius_id', nullable: true })
	genius_id: string

	@ManyToOne(() => GeniusEntity, (genius) => genius.interviews, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'genius_id' })
	genius?: GeniusEntity

	@OneToMany(() => UsageEntity, (usage) => usage.interview)
	usage: UsageEntity[]

	@ManyToOne(() => InterviewFolderEntity, (folder) => folder.interviews, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'folder_id' })
	folder?: InterviewFolderEntity

	@Column({ name: 'folder_id', nullable: true })
	folder_id?: string

	// Columns

	@Column({ enum: InterviewType, default: InterviewType.GENERAL })
	type: InterviewType

	@Column({ default: 'My thoughtly' })
	title: string

	@Column({ default: 'Tessa' })
	ai_name: string

	@Column({ default: InterviewLanguage.en })
	lang: InterviewLanguage

	@Column({ nullable: true })
	error_id?: string

	@Column({ type: 'text', default: '' })
	note_to_subject: string

	@Column({ name: 'notifications', default: true })
	notifications: boolean

	@Column({
		type: 'enum',
		enum: InterviewStatus,
		default: InterviewStatus.ACTIVE,
	})
	status: InterviewStatus

	@Column('text', { array: true, nullable: true, default: () => 'array[]::text[]' })
	response_tags: string[]

	@Column({ nullable: true })
	presence_interim_audio?: PresenceInterimAudio

	@Column({ nullable: true, default: PresenceBackgroundAudio.CALL_CENTER })
	presence_background_audio?: PresenceBackgroundAudio

	@Column({ type: 'jsonb', nullable: true })
	personality_customization?: PersonalityCustomization

	@Column({ default: true })
	should_record?: boolean

	@Column({ default: false })
	should_leave_voicemail: boolean

	@Column({ default: '' })
	voicemail_message: string

	@Column({
		type: 'jsonb',
		nullable: true,
		default: () => `[
			{
				"icon": "phone",
				"color": "#0000FF",
				"description": "Total Responses",
				"value": "TOTAL_RESPONSES",
				"type": "status",
				"method": "sum"
			},
			{
				"icon": "user_check",
				"color": "#FF0000",
				"description": "Ended Responses",
				"value": "ENDED",
				"type": "status",
				"method": "sum"
			},
			{
				"icon": "phone_missed",
				"color": "#808080",
				"description": "No Answer Responses",
				"value": "NO_ANSWER",
				"type": "status",
				"method": "sum"
			},
			{
				"icon": "clock",
				"color": "#00FF00",
				"description": "Pickup Rate",
				"value": "PICKUP_RATE",
				"type": "status",
				"method": "percentage",
				"base": "TOTAL_RESPONSES"
			},
			{
				"icon": "repeat",
				"color": "#800080",
				"description": "Transfer Rate",
				"value": "TRANSFERRED",
				"type": "status",
				"method": "percentage",
				"base": "TOTAL_RESPONSES"
			}
		]`,
	})
	metrics: MetricDetails[]

	toPublic() {
		return {
			id: this.id,
		}
	}

}
