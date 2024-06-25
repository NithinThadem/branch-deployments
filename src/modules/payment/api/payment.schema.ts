import * as Joi from 'joi'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { SubscriptionPlans } from '../../subscription/db/subscription.types'

const paymentSchema = {
	createCheckoutSession: Joi.object().keys({
		plan_name: enumToJoiSchema(SubscriptionPlans).required(),
		coupon: Joi.string().allow('').optional(),
		quantity: Joi.number().optional(),
		disable_proration: Joi.boolean().optional(),
		referral: Joi.string().allow('').optional(),
	}),
}

export default paymentSchema
