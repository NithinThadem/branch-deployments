import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { PhoneNumberEntity } from '../db/phone_number.entity'
import { twilioClient } from '../../../services/twilio'
import stripe, { STRIPE_BASE_URL } from '../../../services/stripe'
import { getPriceId } from '../../subscription/db/subscription.helpers'
import { captureError } from '../../../util/error.util'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { SubscriptionPlans } from '../../subscription/db/subscription.types'
import { LocalInstance } from 'twilio/lib/rest/api/v2010/account/availablePhoneNumberCountry/local'
import { TollFreeInstance } from 'twilio/lib/rest/api/v2010/account/availablePhoneNumberCountry/tollFree'
import analytics from '../../../services/segment'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { getTeamsOfUser } from '../../../modules/user/db/user.helpers'
import { TeamEntity } from '../../team/db/team.entity'

export const getPhoneNumbers = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10
	const direction = req.query.direction

	const queryBuilder = PhoneNumberEntity.createQueryBuilder('phone_number')
		.leftJoinAndSelect('phone_number.team', 'team')
		.leftJoinAndSelect('phone_number.inbound_interview', 'inbound_interview')
		.leftJoinAndSelect('phone_number.outbound_interview', 'outbound_interview')
		.where('team.id = :teamId', { teamId: req.headers.team_id })
		.addOrderBy('phone_number.id', 'ASC')
		.take(resultsPerPage)

	if (req.query.search) {
		queryBuilder.andWhere('phone_number.phone_number ILIKE :search', { search: `%${req.query.search}%` })
	}

	if (req.query.page) {
		queryBuilder.skip(resultsPerPage * req.query.page)
	}

	if (direction) {
		if (direction === 'INBOUND') {
			queryBuilder.andWhere('phone_number.inbound_interview IS NOT NULL')
		} else if (direction === 'OUTBOUND') {
			queryBuilder.andWhere('phone_number.outbound_interview IS NOT NULL')
		}
	}

	const [phone_numbers, count] = await queryBuilder.getManyAndCount()

	return response({
		res,
		data: {
			phone_numbers,
			count,
		},
	})
}

export const fetchAvailableNumbers = async (req: AuthenticatedRequest, res: Response) => {
	const regionCode = req.query.region_code || 'US'

	const searchArgs = {
		limit: Number(req.query.limit) || 10,
		ExcludeAllAddressRequired: true,
		voiceEnabled: true,
		contains: req.query.search,
		areaCode: req.query.area_code,
		beta: false,
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	try {
		let data: TollFreeInstance[] | LocalInstance[]
		if (req.query.type === 'TOLL_FREE') {
			data = await withExponentialBackoff(
				async () => await twilioClient(
					team.twilio_account_sid,
					team.twilio_account_secret
				).availablePhoneNumbers('US')
					.tollFree
					.list({
						...searchArgs,
					})
			)
		} else {
			data = await withExponentialBackoff(
				async () => await twilioClient(
					team.twilio_account_sid,
					team.twilio_account_secret
				).availablePhoneNumbers(regionCode)
					.local
					.list({
						inPostalCode: req.query.postal_code,
						...searchArgs,
					})
			)
		}
		return response({ res, data })
	} catch (error) {
		if (error.code === 20404) {
			return response({ res, data: [] })
		} else {
			captureError(error)
		}
	}
}

export const purchaseNumber = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const teams = await getTeamsOfUser(user.id)
	const team = teams.find((team) => team.id === req.headers.team_id)

	const session = await stripe().checkout.sessions.create({
		customer: team.stripe_customer_id ? team.stripe_customer_id : undefined,
		billing_address_collection: 'auto',
		line_items: [
			{
				price: getPriceId(SubscriptionPlans.PHONE_NUMBER),
				quantity: 1,
			},
		],
		subscription_data: {
			description: `Phone number: ${req.body.phone_number}`,
			metadata: {
				phone_number: req.body.phone_number,
			},
		},
		mode: 'subscription',
		success_url: `${STRIPE_BASE_URL}/phone-number?purchased_number=${req.body.phone_number}`,
		cancel_url: `${STRIPE_BASE_URL}/phone-number/buy`,
		customer_email: team.stripe_customer_id ? undefined : user.email,
		allow_promotion_codes: true,
	})

	analytics.track({
		userId: user.id,
		event: 'Phone Number Purchase Initiated',
		properties: {
			team_id: req.headers.team_id,
			phone_number: req.body.phone_number,
		},
	})

	return response({ res, data: session.url })
}

export const cancelPhoneNumber = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const phoneNumber = await PhoneNumberEntity.findOneOrFail({
		where: {
			phone_number: req.body.phone_number,
			team: {
				id: req.headers.team_id,
			},
		},
		relations: ['subscription', 'team'],
	})

	await Promise.allSettled([
		withExponentialBackoff(() =>
			twilioClient(phoneNumber.team.twilio_account_sid, phoneNumber.team.twilio_account_secret)
				.incomingPhoneNumbers(phoneNumber.twilio_sid)
				.remove()
		),
		phoneNumber.remove().catch(captureError),
		stripe().subscriptions.cancel(phoneNumber.subscription?.stripe_subscription_id).catch(captureError),
	])

	analytics.track({
		userId: user.id,
		event: 'Phone Number Canceled',
		properties: {
			phone_number: req.body.phone_number,
			team_id: req.headers.team_id,
		},
	})

	return response({ res })
}

export const releasePhoneNumber = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	try {
		const phoneNumber = await PhoneNumberEntity.findOneOrFail({
			where: {
				phone_number: req.body.phone_number,
				team_id: req.headers.team_id,
			},
		})

		if (req.body.direction === 'INBOUND') {
			phoneNumber.inbound_interview = null
		} else if (req.body.direction === 'OUTBOUND') {
			phoneNumber.outbound_interview = null
		} else {
			return response({
				res,
				status: 400,
				error: 'Invalid direction specified. Must be "inbound", "outbound", or "all".',
			})
		}

		await phoneNumber.save()

		analytics.track({
			userId: user.id,
			event: 'Phone Number Released',
			properties: {
				phone_number: req.body.phone_number,
				direction: req.body.direction,
				team_id: req.headers.team_id,
			},
		})

		return response({ res, status: 200 })
	} catch (error) {
		console.error('Failed to release phone number:', error)
		return response({
			res,
			status: 500,
			error: 'Failed to release phone number.',
		})
	}
}

export const assignPhoneNumber = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: req.body.interview_id,
			team_id: req.headers.team_id,
		},
		relations: ['inbound_phone_number', 'outbound_phone_number'],
	})

	const phoneNumber = await PhoneNumberEntity.findOneOrFail({
		where: {
			phone_number: req.body.phone_number,
			team_id: req.headers.team_id,
		},
	})

	if (req.body.direction === 'INBOUND') {
		if (interview.inbound_phone_number && interview.inbound_phone_number.phone_number !== phoneNumber.phone_number) {
			const previousPhoneNumber = await PhoneNumberEntity.findOneOrFail({
				where: {
					id: interview.inbound_phone_number.id,
				},
			})
			previousPhoneNumber.inbound_interview = null
			await previousPhoneNumber.save()
		}
		interview.inbound_phone_number = phoneNumber
		phoneNumber.inbound_interview = interview
	} else if (req.body.direction === 'OUTBOUND') {
		if (interview.outbound_phone_number && interview.outbound_phone_number.phone_number !== phoneNumber.phone_number) {
			const previousPhoneNumber = await PhoneNumberEntity.findOneOrFail({
				where: {
					id: interview.outbound_phone_number.id,
				},
			})
			previousPhoneNumber.outbound_interview = null
			await previousPhoneNumber.save()
		}
		interview.outbound_phone_number = phoneNumber
		phoneNumber.outbound_interview = interview
	} else {
		return response({
			res,
			error: 'Invalid direction specified',
		})
	}

	await phoneNumber.save()
	await interview.save()

	analytics.track({
		userId: user.id,
		event: 'Phone Number Assigned',
		properties: {
			phone_number: req.body.phone_number,
			interview_id: req.body.interview_id,
			direction: req.body.direction,
			team_id: req.headers.team_id,
		},
	})

	return response({ res })
}
