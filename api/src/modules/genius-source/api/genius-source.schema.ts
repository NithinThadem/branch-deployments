import * as Joi from 'joi'

const geniusSourceSchema = {
	id: Joi.object().keys({
		source_id: Joi.string().required(),
	}),
	editContent: Joi.object().keys({
		content: Joi.string().required(),
	}),
}

export default geniusSourceSchema
