import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'
import {
	connectCallerId, createCallerId, deleteCallerId, getCallerIds,
} from './caller-id.handlers'
import callerIdSchema from './caller-id.schema'

export const callerIdRouter = Router()

callerIdRouter.get(
	'/',
	validator(callerIdSchema.getCallerIds, RequestPart.QUERY),
	getCallerIds
)

callerIdRouter.post(
	'/',
	validator(callerIdSchema.create, RequestPart.BODY),
	auditMiddleware({
		method: 'POST',
		reason: 'Request to create a caller id',
		resource: 'caller_id',
	}),
	createCallerId
)

callerIdRouter.delete(
	'/:id',
	validator(callerIdSchema.id, RequestPart.PARAMS),
	auditMiddleware({
		method: 'DELETE',
		reason: 'Request to delete a caller id',
		resource: 'caller_id',
	}),
	deleteCallerId
)

callerIdRouter.post(
	'/:id/connect',
	validator(callerIdSchema.id, RequestPart.PARAMS),
	validator(callerIdSchema.connect, RequestPart.BODY),
	auditMiddleware({
		method: 'POST',
		reason: 'Connect a caller id to an interview',
		resource: 'caller_id',
	}),
	connectCallerId
)
