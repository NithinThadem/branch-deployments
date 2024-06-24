import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import { exportUsageToCSV, getUsage } from './usage.handlers'
import usageSchema from './usage.schema'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const usageRouter = Router()
const logDetails = {
	getUsage: {
		method: 'get',
		reason: 'Request to get usage',
		resource: 'usage',
	},
	exportUsage: {
		method: 'get',
		reason: 'Request to export usage',
		resource: 'usage',
	},
}

usageRouter.get(
	'/',
	validator(usageSchema.getUsage, RequestPart.QUERY),
	auditMiddleware(logDetails.getUsage),
	getUsage
)

usageRouter.get(
	'/csv',
	auditMiddleware(logDetails.exportUsage),
	exportUsageToCSV,
)

