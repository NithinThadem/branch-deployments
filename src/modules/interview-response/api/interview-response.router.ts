import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { getInterviewResponse, getNextAndPrevInterviewResponse } from './interview-response.handlers'
import interviewResponseSchema from './interview-response.schema'
import { RequestPart } from '../../../types'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const interviewResponseRouter = Router()
const logDetails = {
	getInterviewResponse: {
		method: 'GET',
		reason: 'Request to get interview responses',
		resource: 'interview-response',
	},
	getNextAndPrevInterviewResponse: {
		method: 'GET',
		reason: 'Request to get next and previous interview responses',
		resource: 'interview-response',
	},
}

interviewResponseRouter.get(
	'/:interview_response_id',
	validator(interviewResponseSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getInterviewResponse),
	getInterviewResponse
)

interviewResponseRouter.get(
	'/:interview_response_id/next_and_prev',
	validator(interviewResponseSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getNextAndPrevInterviewResponse),
	getNextAndPrevInterviewResponse,
)
