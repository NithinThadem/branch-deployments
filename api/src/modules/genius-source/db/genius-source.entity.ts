import {
	Entity,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
	JoinColumn,
	PrimaryGeneratedColumn,
} from 'typeorm'
import { GeniusEntity } from '../../genius/db/genius.entity'
import { GeniusSourceStatus, GeniusSourceType } from './genius-source.types'

@Entity({ name: 'genius_source' })
export class GeniusSourceEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@Column({ name: 'genius_id', nullable: true })
	genius_id?: string

	@ManyToOne(() => GeniusEntity, (genius) => genius.sources)
	@JoinColumn({ name: 'genius_id' })
	genius: GeniusEntity

	// Columns

	@Column()
	name: string

	@Column({ enum: GeniusSourceType })
	type: GeniusSourceType

	@Column({ enum: GeniusSourceStatus, default: GeniusSourceStatus.PROCESSING })
	status: GeniusSourceStatus

	@Column({ nullable: true })
	content?: string

	@Column({ nullable: true })
	file_url?: string

	@Column({ nullable: true })
	vectors?: number

	@Column({ nullable: true })
	url?: string

}
