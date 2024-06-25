import { UserEntity } from '../../../modules/user/db/user.entity'
import { UserTeamStatus } from '../../user/db/user.types'
import { UserTeamEntity } from './user-team.entity'
import { TeamEntity } from '../../../modules/team/db/team.entity'

export const createUserTeam = async ({
	status = UserTeamStatus.ACTIVE,
	user,
	team,
}: {
	user: UserEntity,
	team: TeamEntity,
	status?: UserTeamStatus
}) =>
	await UserTeamEntity.create({
		team_id: team.id,
		user_id: user.id,
		user,
		team,
		status,
	}).save()
