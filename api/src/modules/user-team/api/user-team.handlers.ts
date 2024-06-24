import { AuthenticatedRequest } from '../../../types'
import { UserTeamEntity } from '../db/user-team.entity'
import response from '../../../services/server/response'

export const getUserStatus = async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.query.user_id
	const teamId = req.headers.team_id

	const userTeam = await UserTeamEntity.findOne({
		where: {
			user_id: userId,
			team_id: teamId,
		},
	})

	if (!userTeam) {
		return response({ res, data: {
			status: null,
		} })
	}

	return response({ res, data: {
		status: userTeam.status,
	} })
}
