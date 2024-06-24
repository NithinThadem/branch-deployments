require('dotenv').config()
import 'reflect-metadata'
import logger from './util/logger.util'
import { captureError } from './util/error.util'
import server from './services/server/app'
import dataSource from './services/database/data-source'
import { dbSubscriber } from './services/database/db-subscriber'
import { connectRedis } from './services/redis'
import { isTesting } from './util/env.util'

logger.info(`Starting server in ${process.env.NODE_ENV} mode.`)

process.on('unhandledRejection', (reason, promise) => {
	logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', error => {
	captureError(error)
})

if (isTesting()) {
	logger.info('Running in test mode...')
}

(async () => {
	try {
		// Setup database
		await Promise.all([
			dataSource.initialize(),
			dbSubscriber.connect(),
			connectRedis(),
		])
		// Start server
		server.listen(process.env.PORT || 8080, async () => {
			if (process.env.NODE_ENV === 'development') {
				logger.info(`[Listening] Local: http://${require('os').hostname()}:${process.env.PORT || 8080}`)
				if (process.env.ENABLE_NGROK === 'true') {
					process.env.HOST = await require('ngrok').connect({
						addr: process.env.PORT || 8080,
						authtoken: process.env.NGROK_AUTH_TOKEN,
					})
					logger.info(`[Listening] Remote: ${process.env.HOST}`)
				}
			}
		})
	} catch (error) {
		captureError(error)
	}
})()
