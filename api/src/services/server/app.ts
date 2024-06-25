import * as express from 'express'
import 'express-async-errors'
import * as Sentry from '@sentry/node'
import * as Tracing from '@sentry/tracing'
import logger from '../../util/logger.util'
import router from './router'
import response from './response'
import * as cors from 'cors'
import { ProfilingIntegration } from '@sentry/profiling-node'
import { Server } from 'socket.io'
import initSocketIo from './socket/socket-io'
import { createServer } from 'node:http'
import * as WebSocket from 'ws'
import initWebSocket from './socket/wss'
import { openapiRouter } from './openapi'
import { TriggeredMetadata } from '../../modules/interview-response/db/interview-response.types'

const app = express()
const server = createServer(app)

// Socket.io
const io = new Server(server, {
	path: '/socket.io',
	cors: {
		origin: '*',
	},
	pingInterval: 25000,
	pingTimeout: 20000,
	connectionStateRecovery: {
		maxDisconnectionDuration: 2 * 60 * 1000,
		skipMiddlewares: true,
	},
	destroyUpgrade: false,
})

// Twilio
const twilioWs = new WebSocket.Server({ clientTracking: true, path: '/twilio', noServer: true })

server.on('upgrade', (request, socket, head) => {
	const pathname = new URL(request.url, `http://${request.headers.host}`).pathname

	if (pathname.startsWith('/twilio')) {
		twilioWs.handleUpgrade(request, socket, head, (ws) => {
			twilioWs.emit('connection', ws, request)
		})
	}
})

if (
	process.env.NODE_ENV === 'production' ||
	process.env.NODE_ENV === 'staging'
) {
	Sentry.init({
		environment: process.env.NODE_ENV,
		dsn: process.env.SENTRY_DSN,
		integrations: [
			new ProfilingIntegration(),
			new Sentry.Integrations.Http({ tracing: true }),
			new Tracing.Integrations.Express({
				app,
			}),
		],
		tracesSampleRate: 1.0,
		profilesSampleRate: 1.0,
	})
}

app.use((req, _, next) => {
	logger.info(`[Request] ${req.method} ${req.url}`)
	next()
})

// Pre-route middleware
app.use(cors())
app.use(Sentry.Handlers.requestHandler() as express.RequestHandler)
app.use(Sentry.Handlers.tracingHandler() as express.RequestHandler)

// Handle errors from pre-route middleware (such as JSON parsing errors)
app.use((error, req, res, next) => {
	// Check if JSON parsing error
	if (error instanceof SyntaxError) {
		return response({ res, status: 400, error: 'Invalid Syntax' })
	}

	next()
})

app.use((req, res, next) => {
	try {
		const triggeredBy = req.headers['x-api-token'] ? 'api' : 'dashboard'
		const triggered_metadata: TriggeredMetadata = {
			triggered_by: triggeredBy,
			api_token:
				triggeredBy === 'api' ? req.headers['x-api-token'] : null,
			request_ip:
				req.headers['x-forwarded-for'] || req.connection.remoteAddress,
		}
		req.triggered_metadata = triggered_metadata
	} catch (error) {
		logger.error(error)
	}

	next()
})

// Routes
openapiRouter(app)
router(app)

// Post-route middleware (error handling)
app.use(Sentry.Handlers.errorHandler({ shouldHandleError: () => true }) as express.ErrorRequestHandler)
app.use(async (error, req, res) => {
	if (req.file?.delete) {
		logger.info(`Request error. Deleting file: ${req.file.id}`)
		await req.file.delete()
	}
	return response({ res, status: 500, error, caught: true })
})

initSocketIo(io)
initWebSocket(twilioWs)

export default server
