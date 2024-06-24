import { createLogger, format, transports } from 'winston'
import { isDevelopment, isProduction } from './env.util'

const transportInstances = []

if (isDevelopment()) {
	const fileFormat = format.combine(
		format.errors({ stack: true }),
		format.simple()
	)
	transportInstances.push(
		new transports.File({ filename: 'log/error.log', level: 'error', format: fileFormat }),
		new transports.File({ filename: 'log/console.log', format: fileFormat }),
		new transports.Console({
			format: format.combine(
				format.errors({ stack: true }),
				format.colorize(),
				format.simple()
			),
		})
	)
} else {
	transportInstances.push(
		new transports.Console({
			format: format.combine(
				format.errors({ stack: true }),
				format.simple()
			),
		})
	)
	if (process.env.DATADOG_API_KEY) {
		transportInstances.push(
			new transports.Http({
				format: format.combine(format.errors({ stack: true }), format.json()),
				host: 'http-intake.logs.datadoghq.com',
				path: '/api/v2/logs' +
					`?dd-api-key=${process.env.DATADOG_API_KEY}` +
					'&ddsource=nodejs' +
					`&service=${process.env.K_SERVICE}` +
					`&ddtags=${[
						`env:${process.env.NODE_ENV}`,
						`k_service:${process.env.K_SERVICE}`,
						`k_revision:${process.env.K_REVISION}`,
						`k_configuration:${process.env.K_CONFIGURATION}`,
					].join(',')}`,
				ssl: true,
			}),
		)
	}
}

const logger = createLogger({
	level: isProduction() ? 'debug' : 'debug', // TODO change
	exitOnError: false,
	transports: transportInstances,
	format: format.combine(
		format.timestamp(),
		format.json()
	),
})

export default logger
