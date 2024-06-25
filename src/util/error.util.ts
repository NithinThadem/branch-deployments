/* eslint-disable no-unused-vars */
import * as Sentry from '@sentry/node'
import logger from './logger.util'

export const captureError = (error: any): string|null => {
	let eventId = null
	console.error(error)
	if (process.env.NODE_ENV !== 'development') {
		logger.error(JSON.stringify(error, Object.getOwnPropertyNames(error)))
		eventId = Sentry.captureException(error)
	}
	return eventId
}
