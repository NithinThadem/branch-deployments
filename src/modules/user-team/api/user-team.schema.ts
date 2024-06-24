import * as Joi from 'joi'

const userTeamSchema = {
	user_id: Joi.object().keys({
		user_id: Joi.string().required(),
	}),
}

export default userTeamSchema
