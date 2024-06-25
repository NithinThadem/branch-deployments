import {
	Entity,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	PrimaryGeneratedColumn,
} from 'typeorm'
import { DataPointMetadata, DataPointType, DataPointValueType } from './data-point.types'
import { InterviewResponseType } from '../../interview-response/db/interview-response.types'

@Entity({ name: 'data_point' })
export class DataPointEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Columns

	@Column({ nullable: true })
    interview_id: string

	@Column({ nullable: true })
    response_id: string

    @Column({ nullable: true })
    team_id: string

	@Column({ enum: InterviewResponseType })
	response_type: InterviewResponseType

	@Column()
	type: DataPointType

	@Column()
	value: string

	@Column({ nullable: true })
	node_id?: string

	@Column({ nullable: true })
	value_type?: DataPointValueType

	@Column({ type: 'jsonb', nullable: true })
	metadata?: DataPointMetadata

}
