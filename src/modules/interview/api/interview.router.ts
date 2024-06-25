import { Router } from 'express'
import {
	addResponseTagToInterviewResponse,
	copyInterviewFlow,
	createInterview,
	deleteResponseTagToInterviewResponse,
	exportInterviewInsights,
	getAvailableInterviews,
	getDataPoints,
	getInterview,
	getInterviewFeedback,
	getInterviewInsights,
	getInterviewPreviewAudio,
	getInterviewResponses,
	getInterviews,
	importScript,
	toggleArchiveInterview,
	update,
	updateInterviewInsights,
} from './interview.handlers'
import validator from '../../../services/server/middleware/validator.middleware'
import interviewSchema from './interview.schema'
import { RequestPart } from '../../../types'
import { registerOpenApiSchema } from '../../../services/server/openapi'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { InterviewEntity } from '../db/interview.entity'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const interviewRouter = Router()

const logDetails = {
	insertInterview: {
		method: 'POST',
		reason: 'Request to create an interview',
		resource: 'interview',
	},
	interviewResponses: {
		method: 'GET',
		reason: 'Request to get interview responses by interview id',
		resource: 'interview',
	},
	updateInterview: {
		method: 'UPDATE',
		reason: 'Request to update an interview',
		resource: 'interview',
	},
	getInterviews: {
		method: 'GET',
		reason: 'Request to get all interviews',
		resource: 'interview',
	},
	getInterview: {
		method: 'GET',
		reason: 'Request to get an interview',
		resource: 'interview',
	},
	archiveInterview: {
		method: 'UPDATE',
		reason: 'Request to archive interview',
		resource: 'interview',
	},
	getDataPoints: {
		method: 'GET',
		reason: 'Request to get data points by interview id',
		resource: 'interview',
	},
	copyInterview: {
		method: 'POST',
		reason: 'Request to copy interview',
		resource: 'interview',
	},
	interviewFeedback: {
		method: 'GET',
		reason: 'Request to get interview feedback',
		resource: 'interview',
	},
	importScript: {
		method: 'POST',
		reason: 'Request to import script',
		resource: 'interview',
	},
	addResponseTag: {
		method: 'POST',
		reason: 'Request to add a response tag',
		resource: 'interview',
	},
	deleteResponseTag: {
		method: 'DELETE',
		reason: 'Request to delete response tag',
		resource: 'interview',
	},
	interviewPreviewAudio: {
		method: 'POST',
		reason: 'Request to get interview preview audio',
		resource: 'interview',
	},
	getInsights: {
		method: 'GET',
		reason: 'Request to get a specific report by ID',
		resource: 'interview',
	},
	updateInsights: {
		method: 'PATCH',
		reason: 'Request to update a report',
		resource: 'interview',
	},
	exportInsights: {
		method: 'GET',
		reason: 'Request to export a report',
		resource: 'interview',
	},
}

interviewRouter.post(
	'/create',
	validator(interviewSchema.create, RequestPart.BODY),
	auditMiddleware(logDetails.insertInterview),
	createInterview
)

interviewRouter.put(
	'/:interview_id/update',
	validator(interviewSchema.id, RequestPart.PARAMS),
	validator(interviewSchema.update, RequestPart.BODY),
	auditMiddleware(logDetails.updateInterview),
	update
)

interviewRouter.get(
	'/',
	validator(interviewSchema.getInterviews, RequestPart.QUERY),
	auditMiddleware(logDetails.getInterviews),
	getInterviews
)

registerOpenApiSchema({
	method: 'get',
	path: '/interview',
	description: 'Get interviews',
	validationSchema: [
		{
			schema: interviewSchema.getInterviews,
			requestPart: RequestPart.QUERY,
		},
	],
	responseBody: InterviewEntity,
	isResponseArray: true,
})

interviewRouter.get(
	'/available_interviews',
	auditMiddleware(logDetails.getInterviews),
	getAvailableInterviews
)

interviewRouter.get(
	'/:interview_id',
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getInterview),
	getInterview
)

interviewRouter.get(
	'/:interview_id/responses',
	validator(interviewSchema.id, RequestPart.PARAMS),
	validator(interviewSchema.getInterviewResponses, RequestPart.QUERY),
	auditMiddleware(logDetails.interviewResponses),
	getInterviewResponses
)

registerOpenApiSchema({
	method: 'get',
	path: '/interview/{interview_id}/responses',
	description: 'Get interview responses',
	validationSchema: [
		{
			schema: interviewSchema.id,
			requestPart: RequestPart.PARAMS,
		},
		{
			schema: interviewSchema.getInterviewResponses,
			requestPart: RequestPart.QUERY,
		},
	],
	responseBody: InterviewResponseEntity,
	isResponseArray: true,
})

interviewRouter.put(
	'/:interview_id/toggle_archive',
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.archiveInterview),
	toggleArchiveInterview
)

interviewRouter.get(
	'/:interview_id/data',
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getDataPoints),
	getDataPoints
)

interviewRouter.post(
	'/:interview_id/copy',
	validator(interviewSchema.copy, RequestPart.BODY),
	auditMiddleware(logDetails.copyInterview),
	copyInterviewFlow
)

interviewRouter.get(
	'/:interview_id/feedback',
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.interviewFeedback),
	getInterviewFeedback
)

interviewRouter.post(
	'/import_script',
	validator(interviewSchema.importScript, RequestPart.BODY),
	auditMiddleware(logDetails.importScript),
	importScript
)

interviewRouter.post(
	'/:interview_id/add_tag',
	validator(interviewSchema.tag, RequestPart.BODY),
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.addResponseTag),
	addResponseTagToInterviewResponse
)

interviewRouter.delete(
	'/:interview_id/delete_tag',
	validator(interviewSchema.tag, RequestPart.BODY),
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.deleteResponseTag),
	deleteResponseTagToInterviewResponse
)

interviewRouter.post(
	'/get_preview_audio',
	validator(interviewSchema.getInterviewPreviewAudio, RequestPart.BODY),
	auditMiddleware(logDetails.interviewPreviewAudio),
	getInterviewPreviewAudio,
)

interviewRouter.get(
	'/:interview_id/insights/export',
	validator(interviewSchema.id, RequestPart.PARAMS),
	validator(interviewSchema.exportReport, RequestPart.QUERY),
	auditMiddleware(logDetails.exportInsights),
	exportInterviewInsights
)

interviewRouter.get(
	'/:interview_id/insights',
	validator(interviewSchema.id, RequestPart.PARAMS),
	validator(interviewSchema.getInsights, RequestPart.QUERY),
	auditMiddleware(logDetails.getInsights),
	getInterviewInsights
)

interviewRouter.patch(
	'/:interview_id/insights',
	validator(interviewSchema.update, RequestPart.BODY),
	validator(interviewSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.updateInsights),
	updateInterviewInsights
)
