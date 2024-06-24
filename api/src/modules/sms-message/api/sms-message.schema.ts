import * as Joi from 'joi'

const smsMessageSchema = {
	phoneNumberId: Joi.object().keys({
		phone_number_id: Joi.string().uuid().required(),
	}),
}

export default smsMessageSchema
