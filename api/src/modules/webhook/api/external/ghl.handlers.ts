/* eslint-disable arrow-body-style */
import { Request, Response } from 'express'
import response from '../../../../services/server/response'
import { nangoWebhook } from './nango.handlers'
import { getIntegrationByNangoMetadata } from '../../../integration/db/integration.helpers'

export const ghlHandler = async (req: Request, res: Response) => {
	const locationId = String(req.body.locationId)

	const integration = await getIntegrationByNangoMetadata('locationId', locationId)

	if (!integration || !integration.auth_metadata.nango_connection_id) {
		return response({ res, status: 200 })
	}

	const mockNangoBody = {
		from: 'highlevel',
		type: 'forward',
		connectionId: integration.auth_metadata.nango_connection_id,
		providerConfigKey: 'highlevel',
		authMode: 'OAUTH2',
		provider: 'highlevel',
		environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
		success: true,
		operation: 'operation',
		payload: [req.body],
	}

	try {
		return await nangoWebhook({ body: mockNangoBody } as Request, res)
	} catch (error) {
		return response({ res, status: 500, error: error.message })
	}
}
