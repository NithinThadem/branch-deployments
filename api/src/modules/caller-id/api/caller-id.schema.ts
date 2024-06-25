import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'

const callerIdSchema = {
	getCallerIds: Joi.object().keys({
		// search: Joi.string().optional().allow(''),
	}).concat(apiSchema.paginated),
	create: Joi.object().keys({
		phone_number: Joi.string().required(),
	}),
	id: Joi.object().keys({
		id: Joi.string().required(),
	}),
	connect: Joi.object().keys({
		interview_ids: Joi.array().items(Joi.string()).required(),
	}),
}

export default callerIdSchema
