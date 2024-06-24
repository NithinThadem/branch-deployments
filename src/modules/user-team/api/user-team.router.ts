import { Router } from 'express'
import { getUserStatus } from './user-team.handlers'
import validator from '../../../services/server/middleware/validator.middleware'
import userTeamSchema from './user-team.schema'
import { RequestPart } from '../../../types'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const userTeamRouter = Router()
const logDetails = {
	getUserStatus: {
		method: 'GET',
		reason: 'Request to get user status',
		resource: 'user',
	},
}

userTeamRouter.get(
	'/status',
	validator(userTeamSchema.user_id, RequestPart.QUERY),
	auditMiddleware(logDetails.getUserStatus),
	getUserStatus,
)
