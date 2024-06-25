import { UserTeamStatus } from '../../user/db/user.types'
import { TeamEntity } from '../../team/db/team.entity'
import { UserEntity } from '../../user/db/user.entity'
import {
	Entity,
	Column,
	ManyToOne,
	JoinColumn,
	BaseEntity,
	PrimaryColumn,
} from 'typeorm'

@Entity('user_teams')
export class UserTeamEntity extends BaseEntity {

	@Column({ enum: UserTeamStatus, default: UserTeamStatus.ACTIVE })
	status: UserTeamStatus

	@PrimaryColumn({ name: 'user_id' })
	user_id: string

	@PrimaryColumn({ name: 'team_id' })
	team_id: string

	@ManyToOne(() => UserEntity, user => user.user_teams)
	@JoinColumn({ name: 'user_id' })
	user: UserEntity

	@ManyToOne(() => TeamEntity, team => team.user_teams)
	@JoinColumn({ name: 'team_id' })
	team: TeamEntity

}
