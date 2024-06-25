import * as Joi from 'joi'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { WebhookEventType } from '../db/webhook.types'

const webhookSchema = {
	subscribe: Joi.object().keys({
		type: enumToJoiSchema(WebhookEventType).required(),
		data: Joi.string(),
		url: Joi.string().required(),
	}),
	unsubscribe: Joi.object().keys({
		type: enumToJoiSchema(WebhookEventType).required(),
		data: Joi.string(),
		url: Joi.string().required(),
	}),
	bulkSubscribe: Joi.object().keys({
		type: enumToJoiSchema(WebhookEventType).required(),
		data: Joi.array().items(Joi.string()).required(),
		url: Joi.string().required(),
	}),
	bulkUnsubscribe: Joi.object().keys({
		ids: Joi.array().items(Joi.string()).required(),
	}),
	bulkUpdate: Joi.object().keys({
		ids: Joi.array().items(Joi.string()).required(),
		type: enumToJoiSchema(WebhookEventType),
		url: Joi.string().required(),
	}),
}

export default webhookSchema
