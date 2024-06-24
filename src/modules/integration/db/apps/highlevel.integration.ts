/* eslint-disable max-len */
import logger from '../../../../util/logger.util'
import { systemCallContact, systemCreateContact } from '../../../contact/api/contact.handlers'
import { TriggerEntity } from '../../../trigger/db/trigger.entity'
import ghl from '../../../../services/ghl'
import { LeadSourceTypes } from '../../../contact/db/contact.types'
import axios from 'axios'
import nango from '../../../../services/nango'
import { IntegrationEntity } from '../integration.entity'
import { captureError } from '../../../../util/error.util'

type HighlevelWebhookBody = {
	type: 'ContactUpdate'
	locationId: string
	id: string
	firstName?: string
	lastName?: string
	email?: string
	phone?: string
	tags?: string[]
	country: string
	dateAdded: string
}

/**
 * Handles HighLevel create contact webhook event
 *
 * @param trigger TriggerEntity object that contains the interview and integration
 * @param payload nango HighLevel webhook body
 */
export const handleHighLevelCreateContact = async (trigger: TriggerEntity, payload: HighlevelWebhookBody) => {
	try {
		const ghlContact = await ghl.getContact({
			trigger,
			id: payload.id,
			locationId: trigger?.metadata?.location_id,
		})
		const contact = await systemCreateContact(
			{
				id: ghlContact.id,
				firstName: ghlContact.firstName,
				lastName: ghlContact.lastName,
				email: ghlContact.email,
				phone: ghlContact.phone,
				leadSource: LeadSourceTypes.HIGH_LEVEL,
			},
			trigger.interview.team
		)
		logger.info(`HighLevel contact successfully created / updated in Thoughtly with id ${contact.id}`)

		logger.info('Attempting to call contact...')
		await systemCallContact(
			contact,
			trigger.interview.outbound_phone_number?.phone_number ?? process.env.OUTBOUND_PHONE_NUMBER,
			trigger.interview,
			undefined,
			{
				triggered_by: trigger.name,
				contact: ghlContact,
			},
		)
	} catch (error) {
		captureError(`Failed to handle HighLevel create contact event - ${error.message || error}`)
	}
}
export const getLocationAccessToken = async (agencyToken: string, companyId: string, locationId: string): Promise<string> => {
	const url = 'https://services.leadconnectorhq.com/oauth/locationToken'
	try {
		const response = await axios.post(url, `companyId=${companyId}&locationId=${locationId}`, {
			headers: {
				Authorization: `Bearer ${agencyToken}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Version: '2021-07-28',
			},
		})
		return response.data.access_token
	} catch (error) {
		captureError(error)
	}
}

export const getAgencySubLocations = async (integration: IntegrationEntity) => {
	let accounts: { id: string; name: string }[] = []
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

	return accounts
}
