import * as Joi from 'joi'

const apiTokenSchema = {
	revoke: Joi.object().keys({
		token_id: Joi.string().uuid().required(),
	}),
}

export default apiTokenSchema
