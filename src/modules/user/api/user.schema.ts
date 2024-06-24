import * as Joi from 'joi'
import { parsePhoneNumber } from 'awesome-phonenumber'

export const phoneNumber = Joi.string()
	.custom((value, helper) => {
		const phoneNumber = parsePhoneNumber(value)
		if (phoneNumber.valid) {
			return true
		}
		return helper.error('any.invalid')
	})
	.allow('', null)

const userSchema = {
	login: Joi.object().keys({
		email: Joi.string().email().required(),
		password: Joi.string().required(),
	}),
	register: Joi.object().keys({
		email: Joi.string().email().required(),
		first_name: Joi.string().required(),
		last_name: Joi.string().required(),
		phone_number: phoneNumber.required(),
		password: Joi.string().required(),
	}),
	updateUserDetails: Joi.object().keys({
		first_name: Joi.string().allow('', null),
		last_name: Joi.string().allow('', null),
		avatar: Joi.string().allow('', null),
	}),
	sendPhoneNumberVerificationCode: Joi.object().keys({
		phone_number: phoneNumber.required(),
	}),
	verifyAndSetPhoneNumber: Joi.object().keys({
		phone_number: phoneNumber.required(),
		code: Joi.string().required(),
	}),
}

export default userSchema
