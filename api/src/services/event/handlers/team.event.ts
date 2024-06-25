import { getUsersOfTeam } from '../../../modules/team/api/team.helpers'
import { TeamEntity } from '../../../modules/team/db/team.entity'
import { sendTransactionalEmail } from '../../email'
import { TransactionalEmail } from '../../email/emails.enums'
import { EventMap } from '../event.map'
import { redisRead, redisWrite } from '../../../services/redis'
import { checkForTwilioTeamMigrations } from '../../twilio/twilio.controller'

const onTeamOverAllowedMinutes = async ({ team_id }: EventMap['TEAM_OVER_ALLOWED_MINUTES']) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			id: team_id,
		},
	})

	const teamUserEmails = (await getUsersOfTeam(team_id)).map((user) => user.email)
	await Promise.all(
		teamUserEmails.map(async (teamUserEmail) => {
			const emailSentKey = `email_sent:${team_id}-${teamUserEmail}`
			const emailSent = await redisRead(emailSentKey)

			if (emailSent !== 'true') {
				await sendTransactionalEmail({
					email: teamUserEmail,
					type: TransactionalEmail.TEAM_OVER_MINUTES,
					data: {
						team_name: team.name,
					},
				})
				await redisWrite(emailSentKey, 'true', {
					EX: 3600,
				})
			}
		})
	)
}

const onCheckForTwilioMigrations = async ({ team_id }: EventMap['CHECK_FOR_TWILIO_MIGRATIONS']) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			id: team_id,
		},
	})

	await checkForTwilioTeamMigrations(team)
}

export default {
	onTeamOverAllowedMinutes,
	onCheckForTwilioMigrations,
}
