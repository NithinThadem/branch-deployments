import { PubSub } from '@google-cloud/pubsub'
import { join } from 'path'
import logger from '../../util/logger.util'

const pubsub = new PubSub({
	projectId: process.env.GCP_PROJECT_ID,
	keyFilename: join(
		process.cwd(),
		process.env.GCP_SA_KEY_PATH || './service-account.json'
	),
})

export const publishEvent = (data: any) => {
	try {
		return pubsub.topic(process.env.PUBSUB_TOPIC).publishMessage({
			json: {
				...data,
				token: process.env.PUBSUB_TOKEN,
			},
		})
	} catch (error) {
		logger.error(`Error publishing event to pubsub: ${error}`)
		throw error
	}
}
