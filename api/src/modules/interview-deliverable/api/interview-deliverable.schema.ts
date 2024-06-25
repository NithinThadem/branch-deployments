import * as Joi from 'joi'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { InterviewDeliverableType, Pov } from '../db/interview-deliverable.types'
import apiSchema from '../../../services/server/api.schema'

const interviewDeliverableSchema = {
	interviewSegmentId: Joi.object().keys({
		interview_segment_id: Joi.string().uuid().required(),
	}),
	requestDeliverable: Joi.object().keys({
		type: enumToJoiSchema(InterviewDeliverableType).required(),
		pov: enumToJoiSchema(Pov).optional().allow(''),
	}),
	getDeliverables: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		interview_id: Joi.string().optional().allow(''),
		response_tags: Joi.array().items(Joi.string()).optional(),
		sort: Joi.string().valid('created_asc', 'created_desc').optional(),
	}).concat(apiSchema.paginated),
}

export default interviewDeliverableSchema
