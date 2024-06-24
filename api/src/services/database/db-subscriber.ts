import createSubscriber from 'pg-listen'
import { captureError } from '../../util/error.util'
import logger from '../../util/logger.util'

const getDbConfig = () => {
	const connection = {
		user: process.env.DB_USERNAME,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_DATABASE,
	}

	if (process.env.INSTANCE_CONNECTION_NAME) {
		return {
			...connection,
			host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
		}
	} else if (process.env.DB_HOST) {
		return {
			...connection,
			host: process.env.DB_HOST,
			port: Number(process.env.DB_PORT),
		}
	} else {
		throw new Error('No database host was found in env!')
	}
}

export const dbSubscriber = createSubscriber(getDbConfig())

dbSubscriber.events.on('error', captureError)
dbSubscriber.events.on('connected', () => logger.info('Subscriber connected to database'))
dbSubscriber.events.on('reconnect', () => logger.info('Subscriber reconnected to database'))
dbSubscriber.events.on('notification', (notification) => {
	logger.debug(`Received db notification: ${notification.channel} ${notification.payload}`)
})
