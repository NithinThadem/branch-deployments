import * as Joi from 'joi'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { SubscriptionPlans } from '../db/subscription.types'

const subscriptionSchema = {
	update: Joi.object().keys({
		subscription_id: Joi.string().uuid().required(),
		plan_name: enumToJoiSchema(SubscriptionPlans).required(),
		quantity: Joi.number().optional(),
	}),
}

export default subscriptionSchema
