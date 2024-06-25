import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import interviewDeliverableSchema from './interview-deliverable.schema'
import { createDeliverable, getDeliverables } from './interview-deliverable.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const interviewDeliverableRouter = Router()

const logDetails = {
	createDeliverable: {
		method: 'POST',
		reason: 'Request to create interview deliverable',
		resource: 'interview-deliverable',
	},
	getDeliverables: {
		method: 'GET',
		reason: 'Request to get deliverables',
		resource: 'interview-deliverable',
	},
}

interviewDeliverableRouter.post(
	'/create/:interview_segment_id',
	validator(interviewDeliverableSchema.interviewSegmentId, RequestPart.PARAMS),
	validator(interviewDeliverableSchema.requestDeliverable, RequestPart.BODY),
	auditMiddleware(logDetails.createDeliverable),
	createDeliverable,
)

interviewDeliverableRouter.get(
	'/',
	validator(interviewDeliverableSchema.getDeliverables, RequestPart.QUERY),
	auditMiddleware(logDetails.getDeliverables),
	getDeliverables
)
