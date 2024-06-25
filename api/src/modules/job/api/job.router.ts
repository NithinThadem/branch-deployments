import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import jobSchema from './job.schema'
import {
	createJob, createJobByContacts, createResponsesJob, getJob, getJobs, killJob,
} from './job.handlers'
import { registerOpenApiSchema } from '../../../services/server/openapi'
import { JobEntity } from '../db/job.entity'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const jobRouter = Router()
const logDetails = {
	createJob: {
		method: 'POST',
		reason: 'Request to create a job',
		resource: 'job',
	},
	createResponsesJob: {
		method: 'POST',
		reason: 'request to create responses job',
		resource: 'job',
	},
	createJobByContacts: {
		method: 'POST',
		reason: 'Request to create job by contacts',
		resource: 'job',
	},
	getJobs: {
		method: 'GET',
		reason: 'Requset to get all jobs',
		resource: 'job',
	},
	getJobById: {
		method: 'GET',
		reason: 'Request to get job by id',
		resource: 'job',
	},
	killJob: {
		method: 'DELETE',
		reason: 'Reques to kill job',
		resource: 'job',
	},
}

jobRouter.post(
	'/create',
	validator(jobSchema.create, RequestPart.BODY),
	auditMiddleware(logDetails.createJob),
	createJob
)

jobRouter.post(
	'/create_responses_job',
	validator(jobSchema.createResponsesJob, RequestPart.BODY),
	auditMiddleware(logDetails.createResponsesJob),
	createResponsesJob
)

jobRouter.post(
	'/create_job_by_contacts',
	validator(jobSchema.createJobByContacts, RequestPart.BODY),
	auditMiddleware(logDetails.createJobByContacts),
	createJobByContacts
)

registerOpenApiSchema({
	method: 'post',
	path: '/job/create_job_by_contacts',
	description: 'Create Job',
	validationSchema: [
		{
			schema: jobSchema.createJobByContacts,
			requestPart: RequestPart.BODY,
		},
	],
	responseBody: JobEntity,
	isResponseArray: true,
})

jobRouter.get(
	'/',
	validator(jobSchema.getJobs, RequestPart.QUERY),
	auditMiddleware(logDetails.getJobs),
	getJobs
)

jobRouter.get(
	'/:id',
	validator(jobSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getJobById),
	getJob
)

jobRouter.delete(
	'/:id/cancel',
	validator(jobSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.killJob),
	killJob
)
