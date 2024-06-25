import logger from '../../../util/logger.util'
import { createContact, sendTransactionalEmail } from '../../../services/email'
import { EventMap } from '../event.map'
import { isProduction } from '../../../util/env.util'
import { UserEntity } from '../../../modules/user/db/user.entity'
import { TeamEntity } from '../../../modules/team/db/team.entity'
import { TransactionalEmail } from '../../email/emails.enums'
import { getUsersOfTeam } from '../../../modules/team/api/team.helpers'
import { createSubscriber } from '../../mailerlite'
import { captureError } from '../../../util/error.util'
import { withExponentialBackoff } from '../../../util/helpers.util'

const onUserUpdated = async ({ user_id }: EventMap['USER_UPDATED']) => {
	const user = await UserEntity.findOne({
		where: {
			id: user_id,
		},
	})

	if (isProduction()) {
		await withExponentialBackoff(async () =>
			await createSubscriber({
				email: user.email,
				firstName: user.first_name || '',
				lastName: user.last_name || '',
			}).catch(captureError)
		)

		try {
			await createContact({
				email: user.email,
				firstName: user.first_name || '',
				lastName: user.last_name || '',
			})
		} catch (error) {
			if (error.response?.status === 409) {
				logger.info(`Contact already exists: ${user.email}`)
			} else {
				logger.error('Error creating contact:', error)
			}
		}
	}
}

const onUserInvited = async ({ team_id, invited_user_id, from_user_id }: EventMap['USER_INVITED']) => {
	const [
		team,
		invitedUser,
		fromUser,
	] = await Promise.all([
		TeamEntity.findOne({
			where: {
				id: team_id,
			},
		}),
		UserEntity.findOne({
			where: {
				id: invited_user_id,
			},
		}),
		UserEntity.findOne({
			where: {
				id: from_user_id,
			},
		}),
	])

	await sendTransactionalEmail({
		email: invitedUser.email,
		type: TransactionalEmail.USER_INVITED,
		data: {
			team_id: team.id,
			email: invitedUser.email,
			team_name: team.name,
		},
	})

	const teamUserEmails = (await getUsersOfTeam(team_id)).map((user) => user.email)
	await Promise.all(
		teamUserEmails.map(async (teamUserEmail) => {
			if (teamUserEmail !== invitedUser.email) {
				await sendTransactionalEmail({
					email: teamUserEmail,
					type: TransactionalEmail.NEW_TEAM_MEMBER,
					data: {
						invited_user_email: invitedUser.email,
						from_user_first: fromUser.first_name,
						from_user_last: fromUser.last_name,
					},
				})
			}
		})
	)
}

export {
	onUserUpdated,
	onUserInvited,
}
