/* eslint-disable max-len */
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import EventUtil from '../../../services/event'
import { UserTeamStatus } from '../db/user.types'
import { twilioVerifyClient } from '../../../services/twilio'
import { UserEntity } from '../db/user.entity'
import stripe from '../../../services/stripe'
import logger from '../../../util/logger.util'
import { captureError } from '../../../util/error.util'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { UserTeamEntity } from '../../user-team/db/user-team.entity'
import { getTeamsOfUser } from '../db/user.helpers'
import analytics from '../../../services/segment'
import { emitTwilioMigrationCheckEvent } from '../../../services/twilio/twilio.controller'

export const getUser = async (req: AuthenticatedRequest, res: Response) => {
	if (req.auth.tokenUser) {
		return response({
			res,
			data: req.auth.tokenUser,
		})
	}

	const user = await req.auth.getUser() as UserEntity

	const roles = req.auth.roles || []

	const teams = await getTeamsOfUser(user.id)

	if (teams) {
		for (const team of teams) {
			await emitTwilioMigrationCheckEvent(team)
		}
	}

	return response({
		res,
		data: await user.toPublic(roles),
	})
}

export const updateUserDetails = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser() as UserEntity
	const teamId = req.headers.team_id

	const updateData = {
		first_name: req.body.first_name,
		last_name: req.body.last_name,
		avatar: req.body.avatar,
	}

	if (updateData.first_name) {
		user.first_name = updateData.first_name
	}
	if (updateData.last_name) {
		user.last_name = updateData.last_name
	}
	if (updateData.avatar) {
		user.avatar = updateData.avatar
	}

	await user.save()

	const userTeam = await UserTeamEntity.findOne({
		where: {
			user_id: user.id,
			team_id: teamId,
		},
	})

	if (userTeam) {
		userTeam.status = UserTeamStatus.ACTIVE
		await userTeam.save()
	}

	await EventUtil.asyncEmit('USER_UPDATED', { user_id: user.id })

	return response({ res, data: user.toPublic() })
}

export const sendPhoneNumberVerificationCode = async (req: AuthenticatedRequest, res: Response) => {
	const user = (await req.auth.getUser()) as UserEntity
	const teamId = req.headers.team_id

	await withExponentialBackoff(async () =>
		await twilioVerifyClient().verifications.create({
			to: req.body.phone_number,
			channel: 'sms',
		})
	)

	try {
		analytics.track({
			userId: user.id,
			event: 'Phone Number Verification Initiated',
			properties: {
				team_id: teamId,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({
		res,
		data: {
			phone_number: req.body.phone_number,
		},
	})
}

export const verifyAndSetPhoneNumber = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const code = req.body.code
	const phone_number = req.body.phone_number

	const teams = await getTeamsOfUser(user.id)

	const { status } = await withExponentialBackoff(async () => await twilioVerifyClient().verificationChecks.create({
		to: phone_number,
		code,
	}))

	if (status !== 'approved') {
		return response({ res, error: 'Invalid verification code' })
	} else {
		await UserEntity.update({ id: user.id }, { phone_number })

		try {
			const customer_id = teams[0].stripe_customer_id

			if (
				teams.length === 1 &&
				customer_id
			) {
				logger.info(`Updating Stripe customer ${customer_id} with phone number: ${phone_number}`)

				await stripe().customers.update(customer_id, {
					phone: phone_number,
				})
			}
		} catch (error) {
			captureError(error)
		}

		try {
			analytics.track({
				userId: user.id,
				event: 'Phone Number Verification Completed',
				properties: {
					team_id: teams[0].id,
				},
			})
		} catch (error) {
			captureError(error)
		}

		return response({ res })
	}
}
