import { Request, Response } from 'express'
import logger from '../../../../util/logger.util'
import { IntegrationEntity } from '../../../integration/db/integration.entity'
import { IntegrationApiType } from '../../../integration/db/integration.types'
import nango from '../../../../services/nango'
import { getIntegrationByNangoMetadata } from '../../../integration/db/integration.helpers'
import EventUtil from '../../../../services/event'
import { TriggerEntity } from '../../../trigger/db/trigger.entity'
import { redisRead, redisWrite } from '../../../../services/redis'
import { captureError } from '../../../../util/error.util'
import { getAgencySubLocations } from '../../../integration/db/apps/highlevel.integration'

type NangoWebhookBody = {
	from: string
	type: 'auth' | 'sync' | 'forward'
	connectionId: string
	providerConfigKey: string
	authMode: 'OAUTH2'
	provider: string
	environment: 'prod' | 'dev'
	success: boolean
	operation: string
	payload: any
}

const handleCreateIntegration = async (body: NangoWebhookBody) => {
	const [team_id, user_id] = body.connectionId.split(':')

	logger.info(`Saving integration ${body.provider} for team ${team_id} and user ${user_id}`)

	const connection = await nango.getConnection(body.provider, body.connectionId)

	const metadata: Record<string, any> = {}
	switch (body.provider) {
		case 'highlevel':
			metadata.locationId = connection.credentials.raw.locationId
			metadata.companyId = connection.credentials.raw.companyId
			metadata.userId = connection.credentials.raw.userId
			break
		default: break
	}

	const integration = await IntegrationEntity.create({
		team: {
			id: team_id,
		},
		user: {
			id: user_id,
		},
		slug: body.provider,
		api_type: IntegrationApiType.NANGO,
		auth_metadata: {
			nango_connection_id: body.connectionId,
			nango_connection_config: {
				...connection.connection_config,
				...metadata,
			},
		},
	}).save()

	if (body.provider === 'highlevel' && !integration.auth_metadata.nango_connection_config.locationId) {
		logger.info('HighLevel Agency integration created, fetching locations')
		const locations = await getAgencySubLocations(integration)
		integration.auth_metadata.nango_connection_config.locations = locations
		await integration.save()
	}
}

const handleWebhookEvent = async (body: NangoWebhookBody) => {
	if (!body.connectionId) {
		logger.warn('No connectionId found in Nango webhook payload, skipping')
		return
	}

	const eventId = body.payload[0].eventId
	if (eventId) {
		const duplicate = await redisRead(`triggerEvent-${eventId}`)
		if (duplicate) {
			logger.warn(`Duplicate nango event ${eventId} detected, skipping`)
			return
		}
	}

	let subscriptionType: string
	let integration: IntegrationEntity
	switch (body.from) {
		case 'highlevel':
			subscriptionType = body.payload[0].type
			integration = await getIntegrationByNangoMetadata('locationId', body.payload[0].locationId)
			break
		case 'hubspot':
			subscriptionType = body.payload[0].subscriptionType
			integration = await getIntegrationByNangoMetadata('portalId', body.payload[0].portalId)
			break
		default:
			logger.warn(`Unhandled Nango provider ${body.from}`)
			return
	}
	if (!integration) {
		logger.warn(`No integration found for ${body.from}`)
		return
	}

	const trigger = await TriggerEntity.findOne({
		where: {
			integration: {
				id: integration.id,
			},
			subscription_type: subscriptionType,
		},
	})

	if (!trigger) {
		logger.warn(`No trigger found for ${body.from} subscription type ${subscriptionType}`)
		return
	}

	// Temporarily write nango eventId to redis to prevent duplicate triggers
	if (eventId) {
		await redisWrite(`triggerEvent-${eventId}`, 'active', {
			EX: 60,
		})
	}

	await EventUtil.asyncEmit('INTEGRATION_TRIGGER', {
		trigger_id: trigger.id,
		payload: body.payload[0],
	})
}

export const nangoWebhook = async (req: Request, res: Response) => {
	const body = req.body as NangoWebhookBody

	try {
		if (body.type === 'auth' && body.success) {
			await handleCreateIntegration(body)
		} else if (body.type === 'forward') {
			await handleWebhookEvent(body)
		} else {
			logger.debug(`Ignoring unhandled Nango event type - ${body.type}`)
		}
	} catch (error) {
		captureError(error)
		res.status(500).send()
	}

	res.status(200).send()
}
