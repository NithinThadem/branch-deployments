import { Router } from 'express'
import { getAuditLogs } from './audit-log.handlers'
import validator from '../../../services/server/middleware/validator.middleware'
import auditLogSchema from './audit-log.schema'
import { RequestPart } from '../../../types'

export const auditLogRouter = Router()

auditLogRouter.get(
	'/',
	validator(auditLogSchema.get_audit_logs, RequestPart.QUERY),
	getAuditLogs
)
