/* eslint-disable max-len */
import { v4 } from 'uuid'
import stripe from '../../../services/stripe'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import { TeamEntity } from '../db/team.entity'
import { UserEntity } from '../../user/db/user.entity'
import { createUserTeam } from '../../user-team/db/user-team.helperts'
import { UserTeamEntity } from '../../../modules/user-team/db/user-team.entity'
import { UserTeamStatus } from '../../user/db/user.types'
import { createTwilioCustomerProfileForTeam, createTwilioSubaccountForTeam } from '../../../services/twilio/twilio.helpers'

export const getTeamUserEmails = async (teamId: string): Promise<string[]> => {
	const team = await TeamEntity.findOne({
		where: { id: teamId },
	})

	if (!team) {
		throw new Error('Team not found.')
	}

	return (await getUsersOfTeam(teamId)).map(user => user.email)
}

export const createTeam = async ({
	team,
	user,
}: {
	team: Partial<TeamEntity>,
	user: UserEntity,
}): Promise<TeamEntity> => {
	if (!team.id) {
		team.id = v4()
	}

	const stripeResponse = await stripe().customers.create({
		email: user.email,
	}).catch((error) => {
		captureError(error)
		return null
	})

	const stripe_customer_id = stripeResponse?.id || undefined

	logger.info(`Created Stripe customer ${stripe_customer_id} for team ${team.name}, user: ${user.email}`)

	let twilio_account_sid = null
	let twilio_account_secret = null
	let twilio_customer_profile_sid = null

	try {
		const { sid, secret } = await createTwilioSubaccountForTeam(team)

		twilio_account_sid = sid
		twilio_account_secret = secret
		twilio_customer_profile_sid = await createTwilioCustomerProfileForTeam(team, user.email, twilio_account_sid)
	} catch (error) {
		logger.error(`Error creating Twilio customer profile for team ${team.name}, user: ${user.email}`)
		captureError(error)
	}

	const createdTeam = await TeamEntity.create({
		...team,
		twilio_account_sid,
		twilio_account_secret,
		twilio_metadata: {
			twilio_customer_profile_sid,
		},
		stripe_customer_id,
	}).save()

	/*
		as team entity is created after stripe customer is created, we need to manually set
		the customer to team entity
	*/
	if (stripeResponse) {
		createdTeam.stripe_metadata = stripeResponse
		await createdTeam.save()
	}

	await createUserTeam({
		team: createdTeam,
		user,
	})

	return createdTeam
}

export const getUsersOfTeam = async (teamId: string) => {
	const userTeams = await UserTeamEntity.find({
		where: {
			team_id: teamId,
			status: UserTeamStatus.ACTIVE,
		},
		relations: ['user'],
	})

	if (userTeams.length > 0) {
		return userTeams.map(userTeam => userTeam.user)
	}

	return []
}
