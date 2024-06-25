import * as Joi from 'joi'

const publicSchema = {
	interview_id: Joi.object().keys({
		interview_id: Joi.string().required(),
	}),
	interview_response_id: Joi.object().keys({
		interview_response_id: Joi.string().uuid().required(),
	}),
	start: Joi.object().keys({
		interview_response_id: Joi.string().uuid().optional().allow(''),
		first_name: Joi.string().optional().allow('').max(64),
		last_name: Joi.string().optional().allow('').max(64),
		email: Joi.string().email().optional().allow('').max(64),
		lang: Joi.string().optional().allow('').max(5),
		type: Joi.string().optional().allow(''),
	}),
	uploadSegment: Joi.object().keys({
		transcript: Joi.string().optional().allow(''),
		interview_type: Joi.string().optional(),
		next_topic: Joi.boolean().optional(),
		cumulative_duration_ms: Joi.number().optional(),
	}),
}

export default publicSchema
