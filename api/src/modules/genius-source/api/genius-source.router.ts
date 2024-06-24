import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import { editSource, getSource } from './genius-source.handlers'
import geniusSourceSchema from './genius-source.schema'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const geniusSourceRouter = Router()
const logDetails = {
	getGeniusSource: {
		method: 'GET',
		reason: 'Request to get genius source',
		resource: 'genius-source',
	},
	editGeniusSource: {
		method: 'PUT',
		reason: 'Request to edit genius source',
		resource: 'genius-source',
	},
}

geniusSourceRouter.get(
	'/:source_id',
	validator(geniusSourceSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getGeniusSource),
	getSource
)
geniusSourceRouter.put(
	'/:source_id/edit',
	validator(geniusSourceSchema.editContent, RequestPart.BODY),
	validator(geniusSourceSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.editGeniusSource),
	editSource
)
