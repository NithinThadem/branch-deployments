import { Router } from 'express'
import {
	getGroupedWebhooks, getWebhooks, subscribeWebhook, unsubscribeWebhook, bulkSubscribeWebhooks, bulkUnsubscribeWebhooks,
	bulkUpdateWebhooks,
} from './webhook.handlers'
import validator from '../../../services/server/middleware/validator.middleware'
import webhookSchema from './webhook.schema'
import { RequestPart } from '../../../types'
import { registerOpenApiSchema } from '../../../services/server/openapi'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const webhookRouter = Router()
const logDetails = {
	subscribeWebhook: {
		method: 'POST',
		reason: 'Request to subscribe webhook',
		resource: 'webhook',
	},
	unsubscribeWebhook: {
		method: 'DELETE',
		reason: 'Request to unsubscribe webhook',
		resource: 'webhook',
	},
	getWebhooks: {
		method: 'GET',
		reason: 'Request to get webhooks',
		resource: 'webhook',
	},
	getGroupedWebhooks: {
		method: 'GET',
		reason: 'Request to get webhooks grouped by user, team, type, and url',
		resource: 'webhook',
	},
	bulkSubscribeWebhooks: {
		method: 'POST',
		reason: 'Request to bulk subscribe webhooks',
		resource: 'webhook',
	},
	bulkUnsubscribeWebhooks: {
		method: 'DELETE',
		reason: 'Request to bulk unsubscribe webhooks',
		resource: 'webhook',
	},
	bulkUpdateWebhooks: {
		method: 'PUT',
		reason: 'Request to bulk update webhooks',
		resource: 'webhook',
	},
}

webhookRouter.post(
	'/subscribe',
	validator(webhookSchema.subscribe, RequestPart.BODY),
	auditMiddleware(logDetails.subscribeWebhook),
	subscribeWebhook
)

webhookRouter.post(
	'/bulk-subscribe',
	validator(webhookSchema.bulkSubscribe, RequestPart.BODY),
	auditMiddleware(logDetails.bulkSubscribeWebhooks),
	bulkSubscribeWebhooks
)

registerOpenApiSchema({
	method: 'post',
	path: '/webhooks/subscribe',
	description: 'Subscribe to webhook',
	manualSchema: {
		type: 'object',
		required: ['type', 'url'],
		properties: {
			type: {
				type: 'string',
				enum: ['NEW_RESPONSE', 'PHONE_TRANSFER'],
				description: 'The type of webhook event to subscribe to.',
				example: 'NEW_RESPONSE',
			},
			data: {
				type: 'string',
				nullable: true,
				description: 'Additional data for the webhook event.',
			},
			url: {
				type: 'string',
				format: 'uri',
				description: 'The callback URL to which the webhook should send the event.',
			},
		},
	},
})

webhookRouter.delete(
	'/unsubscribe',
	validator(webhookSchema.unsubscribe, RequestPart.BODY),
	auditMiddleware(logDetails.unsubscribeWebhook),
	unsubscribeWebhook
)

webhookRouter.delete(
	'/bulk-unsubscribe',
	validator(webhookSchema.bulkUnsubscribe, RequestPart.BODY),
	auditMiddleware(logDetails.bulkUnsubscribeWebhooks),
	bulkUnsubscribeWebhooks
)

registerOpenApiSchema({
	method: 'delete',
	path: '/webhooks/unsubscribe',
	description: 'Unsubscribe from webhook',
	validationSchema: [
		{
			schema: webhookSchema.unsubscribe,
			requestPart: RequestPart.BODY,
		},
	],
})

webhookRouter.put(
	'/bulk-update',
	validator(webhookSchema.bulkUpdate, RequestPart.BODY),
	auditMiddleware(logDetails.bulkUpdateWebhooks),
	bulkUpdateWebhooks
)

webhookRouter.get(
	'/',
	auditMiddleware(logDetails.getWebhooks),
	getWebhooks
)

webhookRouter.get(
	'/grouped',
	auditMiddleware(logDetails.getGroupedWebhooks),
	getGroupedWebhooks
)

registerOpenApiSchema({
	method: 'get',
	path: '/webhooks',
	description: 'Get currently active webhooks',
})
