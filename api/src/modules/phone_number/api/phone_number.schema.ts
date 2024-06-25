import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { PhoneNumberType } from '../db/phone_number.types'

const phoneNumberSchema = {
	getPhoneNumbers: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		direction: Joi.string().optional(),
	}).concat(apiSchema.paginated),
	getAvailableNumbers: Joi.object().keys({
		type: enumToJoiSchema(PhoneNumberType).optional(),
		search: Joi.string().optional().allow(''),
		area_code: Joi.string().optional().allow(''),
		postal_code: Joi.string().optional().allow(''),
		region_code: Joi.string().optional().default('US'),
	}).concat(apiSchema.paginated),
	phoneNumber: Joi.object().keys({
		phone_number: Joi.string().required(),
	}),
	assignPhoneNumber: Joi.object().keys({
		phone_number: Joi.string().required(),
		interview_id: Joi.string().required(),
		direction: Joi.string().required(),
	}),
	releasePhoneNumber: Joi.object().keys({
		phone_number: Joi.string().required(),
		direction: Joi.string().required(),
	}),
	buyPhoneNumber: Joi.object().keys({
		phone_number: Joi.string().required(),
	}),
}

export default phoneNumberSchema
