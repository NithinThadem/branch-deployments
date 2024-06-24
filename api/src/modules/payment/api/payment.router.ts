import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import paymentSchema from './payment.schema'
import { createCheckoutSession, createPortalSession } from './payment.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const paymentRouter = Router()
const logDetails = {
	createCheckoutSession: {
		method: 'POST',
		reason: 'Request to create payment checkout session',
		resource: 'payment',
	},
	createPortalSession: {
		method: 'GET',
		reason: 'Reques to get payment portal session',
		resource: 'payment',
	},
}

paymentRouter.post(
	'/create_checkout_session',
	validator(paymentSchema.createCheckoutSession, RequestPart.BODY),
	auditMiddleware(logDetails.createCheckoutSession),
	createCheckoutSession
)

paymentRouter.get(
	'/create_portal_session',
	auditMiddleware(logDetails.createPortalSession),
	createPortalSession
)
