import stripe from '../../../services/stripe'
import { AuthenticatedRequest } from '../../../types'
import { Response } from 'express'
import response from '../../../services/server/response'
import { getPriceId } from '../../subscription/db/subscription.helpers'
import { SubscriptionEntity } from '../db/subscription.entity'
import { SubscriptionStatus } from '../db/subscription.types'
import logger from '../../../util/logger.util'
import dataSource from '../../../services/database/data-source'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { WebhookEntity } from '../../../modules/webhook/db/webhook.entity'
import { In } from 'typeorm'
import { WebhookEventType } from '../../../modules/webhook/db/webhook.types'
import { captureError } from '../../../util/error.util'

export const getSubscription = async (req: AuthenticatedRequest, res: Response) => {
	const subscriptions = await SubscriptionEntity.find({
		where: {
			team_id: req.headers.team_id,
		},
	})

	const data = subscriptions.filter((subscription) => subscription.status === SubscriptionStatus.ACTIVE)

	return response({ res, data })
}

export const updateSubscription = async (req: AuthenticatedRequest, res: Response) => {
	const subscriptionId = req.body.subscription_id
	const newPlanName = req.body.plan_name

	const subscription = await SubscriptionEntity.findOneOrFail({
		where: {
			id: subscriptionId,
			// plan: In([
			// 	SubscriptionPlans.BASIC,
			// 	SubscriptionPlans.PRO,
			// 	SubscriptionPlans.BUSINESS,
			// 	SubscriptionPlans.AGENCY,
			// ]),
		},
	})

	const currentSubscription = await SubscriptionEntity.findOne({
		where: {
			id: subscriptionId,
		},
	})

	if (!currentSubscription) {
		return response({ res, status: 404, data: 'Subscription not found' })
	}

	if (currentSubscription.plan === 'AGENCY' && newPlanName !== 'AGENCY') {
		const updateResult = await dataSource
			.createQueryBuilder()
			.update(InterviewEntity)
			.set({ folder_id: null })
			.where('team_id = :teamId', { teamId: currentSubscription.team_id })
			.execute()

		logger.info(`${updateResult.affected} interviews have been unassigned from folders due to subscription downgrade.`)

		/* check if any folder webhooks and remove them */
		const webhooks = await WebhookEntity.find({
			where: {
				type: In([WebhookEventType.FOLDER_PHONE_TRANSFER, WebhookEventType.FOLDER_NEW_RESPONSE]),
			},
		})

		if (webhooks.length > 0) {
			try {
				await Promise.all(webhooks.map(wh => wh.remove()))
				logger.info(`Count of ${webhooks.length} folder webhooks have been removed from the database.`)
			} catch (error) {
				captureError(error)
				logger.error('Something went wrong while trying to remove folder webhooks.')
			}
		}
	}

	const data = await stripe().subscriptions.update(
		subscription.stripe_subscription_id,
		{
			items: [
				{
					id: subscription.stripe_metadata.items.data[0].id,
					price: getPriceId(req.body.plan_name),
					quantity: req.body.quantity || undefined,
				},
			],
			proration_behavior: 'always_invoice',
			payment_behavior: 'error_if_incomplete',
		}
	)

	logger.info(`Subscription updated: ${subscription.stripe_subscription_id}, status: ${data.status}`)

	if (data.status === 'incomplete') {
		return response({ res, status: 400, data: 'Payment incomplete' })
	}

	subscription.stripe_metadata = data
	subscription.plan = req.body.plan_name
	await subscription.save()

	return response({ res })
}
