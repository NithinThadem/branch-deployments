/* eslint-disable max-len */
import analytics from '../../../services/segment'
import EventUtil from '../../../services/event'
import { deleteFileFromGCS } from '../../../services/server/middleware/file-upload.middleware'
import response from '../../../services/server/response'
import { AuthenticatedRequest } from '../../../types'
import { getTeamAllowedMinutes, getTeamUsedMinutes } from '../../subscription/db/subscription.helpers'
import { UserEntity } from '../../user/db/user.entity'
import { UserTeamStatus } from '../../user/db/user.types'
import { TeamEntity } from '../db/team.entity'
import * as moment from 'moment'
import dataSource from '../../../services/database/data-source'
import { calculateKPIs } from '../../data-point/db/data-point.helpers'
import {
	twilioFetchA2PBrand,
	twilioFetchA2PCampaignUsecases,
	updateTwilioSubaccountName,
} from '../../../services/twilio/twilio.helpers'
import { createTeam } from './team.helpers'
import { captureError } from '../../../util/error.util'
import { UserTeamEntity } from '../../user-team/db/user-team.entity'
import { createUserTeam } from '../../user-team/db/user-team.helperts'
import logger from '../../../util/logger.util'
import {
	emitTwilioMigrationCheckEvent, twilioSubmitA2PBundleAndBrand, twilioSubmitA2PCampaign, twilioSubmitBusinessForReview, twilioSubmitCnamRequest,
} from '../../../services/twilio/twilio.controller'
import { isProduction, isTesting } from '../../../util/env.util'
import { In } from 'typeorm'
import { A2P_CAMPAIGN_STATUS } from '../db/team.types'

export const createTeamHandler = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const team = await createTeam({
		team: {
			name: req.body.name,
		},
		user,
	})

	analytics.track({
		userId: user.id,
		event: 'Team Created',
		properties: {
			team_id: team.id,
			team_name: team.name,
		},
	})

	return response({ res, data: await team.toPublic() })
}

export const createTeamOnboarding = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	if (user.team) {
		return response({ res, status: 403, error: 'User already has a team' })
	}

	user.first_name = req.body.first_name
	user.last_name = req.body.last_name
	await user.save()

	const team = await createTeam({
		team: {
			name: req.body.name,
		},
		user,
	})

	await EventUtil.asyncEmit('USER_UPDATED', { user_id: user.id })

	analytics.track({
		userId: user.id,
		event: 'Team Onboarding',
		properties: {
			team_id: team.id,
			team_name: team.name,
		},
	})

	return response({
		res,
		data: {
			team: team.toPublic(),
			user: user.toPublic(),
		},
	})
}

export const getTeam = async (req: AuthenticatedRequest, res: Response) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	await emitTwilioMigrationCheckEvent(team)

	const userTeams = await UserTeamEntity.find({
		where: {
			team_id: team.id,
			status: In([UserTeamStatus.ACTIVE, UserTeamStatus.INVITED]),
		},
		relations: ['user'],
	})

	return response({
		res,
		data: {
			...team,
			used_minutes: await getTeamUsedMinutes(team),
			allowed_minutes: getTeamAllowedMinutes(team),
			users: userTeams,
		},
	})
}

export const inviteUser = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const email = req.body.email.toLowerCase()

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	const existingUser = await UserEntity.findOne({
		where: { email },
	})

	let invitedUser: UserEntity

	if (existingUser) {
		const userTeam = await UserTeamEntity.findOne({
			where: {
				user_id: existingUser.id,
				team_id: team.id,
			},
		})

		if (!userTeam) {
			await createUserTeam({
				team: team,
				user: existingUser,
				status: UserTeamStatus.INVITED,
			})
		} else {
			if (userTeam.status === UserTeamStatus.INVITED) {
				return response({ res, status: 409, error: 'User has already been invited' })
			}

			if (userTeam.status === UserTeamStatus.ACTIVE) {
				return response({ res, status: 409, error: 'User already on team' })
			}
		}

		invitedUser = existingUser
	} else {
		const createdUser = await UserEntity.create({
			email,
		}).save()

		await createUserTeam({
			user: createdUser,
			team: team,
			status: UserTeamStatus.INVITED,
		})

		invitedUser = createdUser
	}

	await EventUtil.asyncEmit('USER_INVITED', {
		team_id: team.id,
		invited_user_id: invitedUser.id,
		from_user_id: user.id,
	})

	analytics.track({
		userId: user.id,
		event: 'User Invited To Team',
		properties: {
			invited_user_email: email,
			team_id: team.id,
			team_name: team.name,
		},
	})

	return response({ res, data: invitedUser.toPublic() })
}

export const updateTeam = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	const oldName = team.name
	const oldPronunciation = team.name_pronunciation

	if (req.body.name.trim() === '') {
		return response({ res, status: 400, error: 'Team name cannot be empty' })
	}

	team.name = req.body.name
	team.name_pronunciation = req.body.name_pronunciation
	await team.save()

	await updateTwilioSubaccountName(team, req.body.name)
		.catch(captureError)

	analytics.track({
		userId: user.id,
		event: 'Team Updated',
		properties: {
			team_id: team.id,
			old_name: oldName,
			new_name: team.name,
			old_name_pronunciation: oldPronunciation,
			new_name_pronunciation: team.name_pronunciation,
		},
	})

	return response({ res, data: team.toPublic() })
}

export const deleteUserFromTeam = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	const targetUserId = req.body.user_id

	if (!targetUserId) {
		return response({ res, status: 400, error: 'User ID parameter is missing or invalid' })
	}

	const targetUser = await UserEntity.findOneOrFail({
		where: {
			id: targetUserId,
		},
		relations: ['user_teams'],
	})

	if (!targetUser) {
		return response({ res, status: 404, error: 'Target user not found' })
	}

	const userTeam = await UserTeamEntity.findOneOrFail({
		where: {
			user: {
				id: targetUser.id,
			},
			team: {
				id: team.id,
			},
		},
	})

	userTeam.status = UserTeamStatus.REMOVED
	await userTeam.save()

	analytics.track({
		userId: user.id,
		event: 'User Removed From Team',
		properties: {
			removed_user_id: targetUserId,
			team_id: team.id,
			team_name: team.name,
		},
	})

	return response({ res, status: 200 })
}

export const uploadTeamLogo = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	if (team.logo_url) {
		await deleteFileFromGCS(team.logo_url)
	}

	team.logo_url = req.file.url
	await team.save()

	analytics.track({
		userId: user.id,
		event: 'Team Logo Uploaded',
		properties: {
			team_id: team.id,
			logo_url: req.file.url,
		},
	})

	return response({ res, data: team })
}

export const getTeamDataPoints = async (req: AuthenticatedRequest, res: Response) => {
	const teamId = req.headers.team_id
	const medium = req.query.medium
	const interviewId = req.query.interview_id
	const endDateParam = req.query.end_date ? moment(req.query.end_date) : moment()
	const timeFrame = req.query.time_frame || 'month'

	let startDate; let
		previousStartDate
	switch (timeFrame) {
		case 'day':
			startDate = endDateParam.clone().subtract(1, 'days')
			previousStartDate = startDate.clone().subtract(1, 'days')
			break
		case 'week':
			startDate = endDateParam.clone().subtract(1, 'weeks')
			previousStartDate = startDate.clone().subtract(1, 'weeks')
			break
		case 'month':
			startDate = endDateParam.clone().subtract(1, 'months')
			previousStartDate = startDate.clone().subtract(1, 'months')
			break
	}
	const endDate = endDateParam.clone()

	const formatSQLDate = (date) => date.format('YYYY-MM-DD HH:mm:ss')

	const queryParams = [teamId]
	const whereConditions = ['team_id = $1']
	let paramIndex = 2

	if (medium) {
		const mediumArray = Array.isArray(medium) ? medium : [medium]
		if (mediumArray.length > 0) {
			const mediumPlaceholders = mediumArray.map((_, index) => `$${paramIndex + index}`).join(', ')
			queryParams.push(...mediumArray)
			whereConditions.push(`response_type IN (${mediumPlaceholders})`)
			paramIndex += mediumArray.length
		}
	}

	if (interviewId) {
		queryParams.push(interviewId)
		whereConditions.push(`interview_id = $${paramIndex++}`)
	}

	const whereClause = whereConditions.join(' AND ')

	const sqlQuery = `
        WITH period_data AS (
            SELECT
                CASE
                    WHEN created >= '${formatSQLDate(startDate)}' AND  created <= '${formatSQLDate(endDate)}' THEN 'current'
                    WHEN created >= '${formatSQLDate(previousStartDate)}' AND created < '${formatSQLDate(startDate)}'  THEN 'previous'
                END AS period,
                data_point.*
            FROM
                data_point
            WHERE
                ${whereClause}
                AND created >= '${formatSQLDate(previousStartDate)}'
                AND created <= '${formatSQLDate(endDate)}'
        )
        SELECT * FROM period_data
    `

	const rawDataPoints = await dataSource.query(sqlQuery, queryParams)

	const currentPeriodDataPoints = rawDataPoints.filter(dp => dp.period === 'current')
	const previousPeriodDataPoints = rawDataPoints.filter(dp => dp.period === 'previous')

	const kpisCurrentPeriod = calculateKPIs(currentPeriodDataPoints, startDate.toDate(), endDate.toDate(), interviewId)
	const kpisPreviousPeriod = calculateKPIs(previousPeriodDataPoints, previousStartDate.toDate(), startDate.toDate(), interviewId)

	return response({ res, data: { currentPeriod: kpisCurrentPeriod, previousPeriod: kpisPreviousPeriod } })
}

export const getTwilioA2PCampaignUsecases = async (req: AuthenticatedRequest, res: Response) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	const usecases = await twilioFetchA2PCampaignUsecases({
		messagingServiceSid: team.twilio_metadata.twilio_customer_messaging_service_sid,
		brandRegistrationSid: team.twilio_metadata.twilio_customer_brand_registration_sid,
		team,
	})

	return response({ res, data: usecases })
}

interface SubmitA2PResponse {
	data: {
		success: boolean,
		errors?: {
			reason: string
			field: string
		}[]
	}
}

export const submitBusinessMetadataForReview = async (req: AuthenticatedRequest, res: Response) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
		relations: ['phone_numbers'],
	})

	const user = await req.auth.getUser()

	team.business_metadata = {
		...team.business_metadata,
		...req.body,
		email: user.email,
	}

	await team.save()

	let data

	if (isTesting()) {
		data = {
			account_sid: team.twilio_account_sid,
			bundle_sid: team.twilio_metadata.twilio_customer_profile_sid,
		}
	}

	if (team.twilio_metadata.twilio_customer_profile_status !== 'draft') {
		const customerProfileResult: SubmitA2PResponse = await twilioSubmitBusinessForReview(team, user)

		if (!customerProfileResult.data.success) {
			return response({
				res,
				status: 400,
				data: {
					...customerProfileResult.data,
					...data,
				},
			})
		}
	}

	const customerProfileResult: SubmitA2PResponse = await twilioSubmitBusinessForReview(team, user)

	if (!customerProfileResult.data.success) {
		return response({
			res,
			status: 400,
			data: customerProfileResult.data,
		})
	}

	/* if customer profile is already approved, submit the brand */

	if (team.twilio_metadata.twilio_customer_profile_status === 'twilio-approved') {
		const a2pResult: SubmitA2PResponse = await twilioSubmitA2PBundleAndBrand({
			team,
			isMock: !isProduction(),
		})

		if (!a2pResult.data.success) {
			return response({
				res,
				status: 400,
				data: {
					...a2pResult.data,
					...data,
				},
			})
		}
	}

	try {
		logger.info(`Submitting CNAM request for team ${team.id}`)

		await twilioSubmitCnamRequest(team)
	} catch (error) {
		captureError(error)
	}

	if (team.twilio_metadata.twilio_customer_brand_registration_sid) {
		try {
			const brand = await twilioFetchA2PBrand({
				team,
				brandRegistrationSid: team.twilio_metadata.twilio_customer_brand_registration_sid,
			})

			/* if brand is approved and campaign has not submitted yet */
			if (brand && brand.status === 'APPROVED' && (team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.DRAFT ||
				team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.FAILURE ||
				!team.twilio_metadata.twilio_customer_a2p_campaign_status
			)) {
				/* submit a2p campaign if brand is approved already */
				logger.info(`A2P Brand is already approved, submitting A2P Campaign for team ${team.name}`)
				await twilioSubmitA2PCampaign(team)
			}
		} catch (error) {
			captureError(error)
			logger.error(`Error while trying to fetch the brand: ${team.twilio_metadata.twilio_customer_brand_registration_sid}`)
		}
	}

	return response({
		res,
		data,
		status: 200,
	})
}

export const createContactView = async (req: AuthenticatedRequest, res: Response) => {
	const { teamId, viewName, attributeKeys } = req.body
	try {
		const team = await TeamEntity.findOneOrFail({ where: { id: teamId } })

		team.contact_views = [...team.contact_views, { name: viewName, attribute_keys: attributeKeys }]
		await team.save()

		return response({ res, data: team.contact_views })
	} catch (error) {
		logger.error(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const deleteContactView = async (req: AuthenticatedRequest, res: Response) => {
	const { teamId, viewName } = req.body
	try {
		const team = await TeamEntity.findOneOrFail({ where: { id: teamId } })

		team.contact_views = team.contact_views.filter(view => view.name !== viewName)
		await team.save()

		return response({ res, data: team.contact_views })
	} catch (error) {
		logger.error(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const updateContactView = async (req: AuthenticatedRequest, res: Response) => {
	const { teamId, viewName, newViewName, newAttributeKeys } = req.body

	try {
		const team = await TeamEntity.findOneOrFail({ where: { id: teamId } })

		team.contact_views = team.contact_views.map(view => {
			if (view.name === viewName) {
				return { name: newViewName || view.name, attribute_keys: newAttributeKeys || view.attribute_keys }
			}
			return view
		})
		await team.save()

		return response({ res, data: team.contact_views })
	} catch (error) {
		logger.error(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getContactViews = async (req: AuthenticatedRequest, res: Response) => {
	const teamId = req.headers.team_id

	try {
		const team = await TeamEntity.findOneOrFail({ where: { id: teamId }, relations: ['contacts'] })
		const views = team.contact_views
		const contacts = team.contacts.map(contact => {
			const contactData = {}
			views.forEach(view => {
				view.attribute_keys.forEach(key => {
					contactData[key] = contact[key]
				})
			})
			return contactData
		})

		return response({ res, data: { views, contacts } })
	} catch (error) {
		logger.error(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}
