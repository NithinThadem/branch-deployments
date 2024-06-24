import * as Joi from 'joi'

const interviewResponseSchema = {
	id: Joi.object().keys({
		interview_response_id: Joi.string().uuid().required(),
	}),
}

export default interviewResponseSchema
