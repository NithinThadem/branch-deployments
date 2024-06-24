import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	ManyToOne,
} from 'typeorm'
import { TeamEntity } from '../../team/db/team.entity'
import { UserEntity } from '../../user/db/user.entity'

@Entity({ name: 'api_token' })
export class ApiTokenEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@ManyToOne(() => TeamEntity, team => team.api_tokens, { nullable: false })
	team: TeamEntity

	@ManyToOne(() => UserEntity, user => user.api_tokens, { nullable: false })
	user: UserEntity

	// Columns

	@Column()
	token: string

	toPublic() {
		return {
			id: this.id,
			created: this.created,
			team: this.team?.toPublic(),
			user: this.user?.toPublic(),
			token: this.token,
		}
	}

}
