import { Router } from 'express'
import { RequestPart } from '../../../types'
import {
	getInterview, uploadSegment, markResponseEnded, startResponse, getResponse,
} from './public.handlers'
import publicSchema from './public.schema'
import validator from '../../../services/server/middleware/validator.middleware'

export const publicRouter = Router()

publicRouter.post(
	'/interview/:interview_id/start',
	validator(publicSchema.interview_id, RequestPart.PARAMS),
	validator(publicSchema.start, RequestPart.BODY),
	startResponse
)

publicRouter.post(
	'/interview_response/:interview_response_id/upload_segment',
	validator(publicSchema.interview_response_id, RequestPart.PARAMS),
	validator(publicSchema.uploadSegment, RequestPart.BODY),
	uploadSegment
)

publicRouter.get(
	'/interview/:interview_id',
	validator(publicSchema.interview_id, RequestPart.PARAMS),
	getInterview
)

publicRouter.get(
	'/interview_response/:interview_response_id',
	validator(publicSchema.interview_response_id, RequestPart.PARAMS),
	getResponse
)

publicRouter.post(
	'/interview_response/:interview_response_id/end',
	validator(publicSchema.interview_response_id, RequestPart.PARAMS),
	markResponseEnded
)
