import EventUtil from '../../../services/event'
import { UserEntity } from './user.entity'
import { UserTeamStatus } from './user.types'
import analytics from '../../../services/segment'
import { UserTeamEntity } from '../../user-team/db/user-team.entity'
import { getTeamAllowedMinutes } from '../../../modules/subscription/db/subscription.helpers'
import { getTeamUsedMinutes } from '../../../modules/subscription/db/subscription.helpers'

export const getOrCreateUser = async (email: string, relations: string[] = [], team_id?: string): Promise<UserEntity> => {
	let user = await UserEntity.findOne({
		where: { email },
		relations: relations,
	})

	if (!user) {
		user = await UserEntity.create({ email }).save()
		analytics.track({
			userId: user.id,
			event: 'Sign Up',
		})
		await EventUtil.asyncEmit('USER_UPDATED', { user_id: user.id })
	} else {
		if (team_id) {
			const userTeam = await UserTeamEntity.findOne({
				where: {
					user_id: user.id,
					team_id,
				},
			})

			if (userTeam && userTeam.status === UserTeamStatus.INVITED) {
				userTeam.status = UserTeamStatus.ACTIVE
				await userTeam.save()
				await EventUtil.asyncEmit('USER_UPDATED', { user_id: user.id })
			}
		}
	}

	return user
}

export const getRawTeamsOfUser = async (user_id?: string) => {
	const userTeams = await UserTeamEntity.find({
		where: {
			user_id: user_id,
		},
		relations: ['team'],
	})
	return userTeams?.map((userTeam) => userTeam.team) ?? []
}

export const getTeamsOfUser = async (user_id?: string) => {
	const userTeams = await UserTeamEntity.find({
		where: {
			user_id: user_id,
		},
		relations: ['team'],
	})

	if (userTeams.length > 0) {
		const teamPromises = userTeams.map(async (u) => {
			const allowedMinutes = getTeamAllowedMinutes(u.team)
			const usedMinutes = await getTeamUsedMinutes(u.team)

			return Object.assign(u.team, { allowed_minutes: allowedMinutes, used_minutes: usedMinutes })
		})

		const teamsPublic = await Promise.all(teamPromises)
		return teamsPublic
	}

	return []
}
