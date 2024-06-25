/* eslint-disable max-len */
import { HubspotContact, LeadSourceTypes } from '../../../contact/db/contact.types'
import nango from '../../../../services/nango'
import logger from '../../../../util/logger.util'
import { systemCallContact, systemCreateContact } from '../../../contact/api/contact.handlers'
import { TriggerEntity } from '../../../trigger/db/trigger.entity'

type HubspotWebhookBody = {
	subscriptionType: 'contact.propertyChange' | 'contact.creation'
	objectId: string
	propertyName?: string
	propertyValue?: string
}

/**
 * Handles HubSpot create contact webhook event
 *
 * @param trigger TriggerEntity object that contains the interview and integration
 * @param payload nango HubSpot webhook body
 */
export const handleHubspotCreateContact = async (trigger: TriggerEntity, payload: HubspotWebhookBody) => {
	try {
		const team = trigger.interview.team
		const response = await nango.get({
			endpoint: `/crm/v3/objects/contacts/${payload.objectId}?properties=phone,email,firstname,lastname`,
			providerConfigKey: trigger.integration.slug,
			connectionId: trigger.integration.auth_metadata.nango_connection_id,
		})

		const hubspotContact: HubspotContact = response.data

		const contact = await systemCreateContact(
			{
				id: hubspotContact.id,
				firstName: hubspotContact.properties.firstname,
				lastName: hubspotContact.properties.lastname,
				email: hubspotContact.properties.email,
				phone: hubspotContact.properties.phone,
				leadSource: LeadSourceTypes.HUBSPOT,
			},
			team
		)
		logger.info(`HubSpot contact successfully created / updated in Thoughtly with id ${contact.id}`)

		logger.info('Attempting to call contact...')
		await systemCallContact(contact, trigger.interview.outbound_phone_number?.phone_number ?? process.env.OUTBOUND_PHONE_NUMBER, trigger.interview)
	} catch (error) {
		logger.error(`Failed to handle Hubspot create contact event - ${error.message || error}`)
	}
}
