/* eslint-disable max-len */
import axios from 'axios'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { IntegrationEntity } from '../db/integration.entity'
import * as crypto from 'node:crypto'
import nango from '../../../services/nango'
import logger from '../../../util/logger.util'
import { getLocationAccessToken } from '../db/apps/highlevel.integration'

export const getConnectedIntegrations = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Getting connected integrations', { team_id: req.headers.team_id })
	const integrations = await IntegrationEntity.find({
		where: {
			team: {
				id: req.headers.team_id,
			},
		},
	})

	return response({
		res,
		data: integrations.map(integration => integration.toPublic()),
	})
}

export const getZapierApps = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Getting Zapier Apps', { team_id: req.headers.team_id })
	const { data } = await axios({
		method: 'GET',
		url: 'https://api.zapier.com/v1/apps',
		params: {
			client_id: process.env.ZAPIER_CLIENT_ID,
			title_search: req.query.search,
			per_page: req.query.limit,
			page: req.query.page,
		},
	})
	return response({ res, data: data })
}

export const getAvailableGHLAccounts = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Getting available GHL Calendars', { team_id: req.headers.team_id })
	const integration = await IntegrationEntity.findOne({
		where: {
			team: {
				id: req.headers.team_id,
			},
			slug: 'highlevel',
		},
	})
	if (!integration) {
		return response({ res, error: 'Integration not found' })
	}
	let accounts
	const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)

	if (!integration.auth_metadata.nango_connection_config.locationId) {
		const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)
		const data = await axios.get(`https://services.leadconnectorhq.com/locations/search?companyId=${integration.auth_metadata.nango_connection_config.companyId}`, {
			headers: {
				Authorization: `Bearer ${connection.credentials.raw.access_token}`,
				Version: '2021-04-15',
			},
		})

		accounts = data.data.locations.map((location: any) => ({
			id: location.id,
			name: location.name,
		}))
	} else {
		const locationData = await axios.get(`https://services.leadconnectorhq.com/locations/${integration.auth_metadata.nango_connection_config.locationId}`, {
			headers: {
				Authorization: `Bearer ${connection.credentials.raw.access_token}`,
				Version: '2021-04-15',
			},
		})
		accounts = [{
			id: integration.auth_metadata.nango_connection_config.locationId,
			name: locationData.data.location.name,
		}]
	}

	return response({ res, data: accounts })
}

export const getAvailableGHLCalendars = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Getting available GHL Calendars', { team_id: req.headers.team_id })
	let locationId: string
	let accessToken: string
	const accountLocationId = req.query.account_location_id

	const integration = await IntegrationEntity.findOne({
		where: {
			team: {
				id: req.headers.team_id,
			},
			slug: 'highlevel',
		},
	})

	if (!integration) {
		return response({ res, error: 'Integration not found' })
	}

	const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)

	if (integration.auth_metadata.nango_connection_config.locationId) {
		locationId = integration.auth_metadata.nango_connection_config.locationId
		accessToken = connection.credentials.raw.access_token
	} else {
		locationId = accountLocationId
		accessToken = await getLocationAccessToken(connection.credentials.raw.access_token, integration.auth_metadata.nango_connection_config.companyId, accountLocationId)
	}

	const data = await axios.get(`https://services.leadconnectorhq.com/calendars/?locationId=${locationId}`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Version: '2021-04-15',
		},
	})

	const calendars = data.data.calendars.map((calendar: any) => ({
		id: calendar.id,
		name: calendar.name,
		calendarType: calendar.calendarType,
	}))

	return response({ res, data: calendars })
}

export const exchangeNangoHmac = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Exchanging Nango HMAC', { connection_id: req.body.connection_id, slug: req.body.slug })
	const digest = crypto.createHmac('sha256', process.env.NANGO_HMAC_SECRET)
		.update(`${req.body.slug}:${req.body.connection_id}`)
		.digest('hex')

	return response({ res, data: { digest } })
}

export const deleteNangoIntegration = async (req: AuthenticatedRequest, res: Response) => {
	logger.info('Deleting Nango Integration', { integration_id: req.params.integration_id })
	const integration = await IntegrationEntity.findOne({
		where: {
			team: {
				id: req.headers.team_id,
			},
			id: req.params.integration_id,
		},
	})

	if (!integration) {
		return response({ res, error: 'Integration not found' })
	}

	await integration.remove()
	await nango.deleteConnection(integration.slug, integration.auth_metadata.nango_connection_id)

	return response({ res, status: 204 })
}
