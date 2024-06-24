/* eslint-disable max-len */
import stripe, { STRIPE_CANCEL_URL, STRIPE_RETURN_URL, STRIPE_SUCCESS_URL } from '../../../services/stripe'
import { AuthenticatedRequest } from '../../../types'
import { Response } from 'express'
import { UserEntity } from '../../user/db/user.entity'
import response from '../../../services/server/response'
import Stripe from 'stripe'
import { getPriceId } from '../../subscription/db/subscription.helpers'
import { TeamEntity } from '../../team/db/team.entity'
import logger from '../../../util/logger.util'
import { getTeamsOfUser } from '../../../modules/user/db/user.helpers'

export const createCheckoutSession = async (req: AuthenticatedRequest, res: Response) => {
	const user: UserEntity = await req.auth.getUser()
	const teams = await getTeamsOfUser(user.id)
	const team = teams.find((team) => team.id === req.headers.team_id) as TeamEntity

	if (!team) {
		return response({ res, status: 403, error: 'Forbidden' })
	}

	const price = getPriceId(req.body.plan_name)

	const params: Stripe.Checkout.SessionCreateParams = {
		customer: team.stripe_customer_id ? team.stripe_customer_id : undefined,
		billing_address_collection: 'auto',
		line_items: [
			{
				price,
				quantity: req.body.quantity || 1,
			},
		],
		mode: 'subscription',
		success_url: STRIPE_SUCCESS_URL +
			`?target_plan=${req.body.plan_name}&origin_plan=${team.subscriptions.length > 0
				? team.subscriptions[0].plan : 'FREE'}`,
		cancel_url: STRIPE_CANCEL_URL,
		customer_email: team.stripe_customer_id ? undefined : user.email,
		allow_promotion_codes: true,
		subscription_data: req.body.disable_proration ? {
			proration_behavior: req.body.disable_proration ? 'none' : 'create_prorations',
			billing_cycle_anchor: req.body.disable_proration ? Math.floor(new Date().getTime() / 1000) : undefined,
		} : undefined,
		metadata: {
			tolt_referral: req.body.referral,
		},
		consent_collection: {
			terms_of_service: 'required',
		},
		custom_text: {
			terms_of_service_acceptance: {
				message: 'I agree to the [Terms of Service](https://thought.ly/terms) and [Privacy Policy](https://thought.ly/privacy).',
			},
		},
	}

	if (req.body.coupon?.length) {
		params.discounts = [{
			coupon: req.body.coupon,
		}]
	}

	const session = await stripe().checkout.sessions.create(params)

	if (session.customer !== team.stripe_customer_id) {
		team.stripe_customer_id = session.customer as string
		await user.save()
	}

	return response({ res, data: session.url })
}

export const createPortalSession = async (req: AuthenticatedRequest, res: Response) => {
	const user = await UserEntity.findOne({
		where: { email: req.auth.email },
	})
	const teams = await getTeamsOfUser(user.id)

	const team = teams.find((team) => team.id === req.headers.team_id) as TeamEntity

	if (!team) {
		return response({ res, status: 403, error: 'Forbidden' })
	}

	if (!team.stripe_customer_id) {
		logger.info(`Creating Stripe customer for team ${team.id}`)
		const { id } = await stripe().customers.create({
			email: user.email,
		})
		team.stripe_customer_id = id
		await team.save()
	}

	const portalSession = await stripe().billingPortal.sessions.create({
		customer: team.stripe_customer_id,
		return_url: STRIPE_RETURN_URL,
	})

	return response({ res, data: portalSession.url })
}
