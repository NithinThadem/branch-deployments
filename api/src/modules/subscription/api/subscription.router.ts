import { Router } from 'express'
import { getSubscription, updateSubscription } from './subscription.handlers'
import validator from '../../../services/server/middleware/validator.middleware'
import subscriptionSchema from './subscription.schema'
import { RequestPart } from '../../../types'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const subscriptionRouter = Router()
const logDetails = {
	getSubscription: {
		method: 'GET',
		reason: 'Request to get subscription',
		resource: 'subscription',
	},
	updateSubscription: {
		method: 'POST',
		reason: 'Request to update subscription',
		resource: 'subscription',
	},
}

subscriptionRouter.get(
	'/',
	auditMiddleware(logDetails.getSubscription),
	getSubscription
)

subscriptionRouter.post(
	'/update',
	validator(subscriptionSchema.update, RequestPart.BODY),
	auditMiddleware(logDetails.updateSubscription),
	updateSubscription
)
