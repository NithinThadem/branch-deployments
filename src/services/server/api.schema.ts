import * as Joi from 'joi'

const apiSchema = {
	paginated: Joi.object().keys({
		page: Joi.number().integer().min(0).default(0).optional(),
		limit: Joi.number().integer().min(1).max(50).default(20).optional(),
	}),
}

export default apiSchema
