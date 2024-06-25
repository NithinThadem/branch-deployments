/* eslint-disable max-len */
import { TriggerEntity } from '../../../modules/trigger/db/trigger.entity'
import { handleHubspotCreateContact } from '../../../modules/integration/db/apps/hubspot.integration'
import { handleHighLevelCreateContact } from '../../../modules/integration/db/apps/highlevel.integration'
import logger from '../../../util/logger.util'
import { EventMap } from '../event.map'

const onIntegrationTrigger = async ({ trigger_id, payload }: EventMap['INTEGRATION_TRIGGER']) => {
	const trigger = await TriggerEntity.findOne({
		where: {
			id: trigger_id,
		},
		relations: ['interview', 'integration', 'interview.team', 'interview.flow', 'interview.outbound_phone_number'],
	})

	if (!trigger) {
		logger.error(`Trigger not found for id: ${trigger_id}`)
		return
	}

	const slug = `${trigger.integration.slug}-${trigger.subscription_type}`
	switch (slug) {
		case 'hubspot-contact.creation': {
			await handleHubspotCreateContact(trigger, payload)
			break
		}
		case 'highlevel-ContactCreate': {
			await handleHighLevelCreateContact(trigger, payload)
			break
		}
		default: {
			logger.warn(`Subscription type ${trigger.subscription_type} not yet supported for integration ${trigger.integration.slug}`)
			break
		}
	}
}

export default {
	onIntegrationTrigger,
}
