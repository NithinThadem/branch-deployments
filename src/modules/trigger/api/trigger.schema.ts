import * as Joi from 'joi'

const triggerSchema = {
	id: Joi.object().keys({
		trigger_id: Joi.string().uuid().required(),
	}),
	create_trigger: Joi.object().keys({
		integration_id: Joi.string().required(),
		location_id: Joi.string().required(),
		interview_id: Joi.string().required(),
		subscription_type: Joi.string().required(),
		name: Joi.string().required(),
	}),
	get_trigger_query: Joi.object().keys({
		interview_id: Joi.string().required(),
	}),
	delete_trigger: Joi.object().keys({
		trigger_id: Joi.string().uuid().required(),
	}),
}

export default triggerSchema
