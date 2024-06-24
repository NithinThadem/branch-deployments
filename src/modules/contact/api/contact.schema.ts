import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'

const contactSchema = {
	createContact: Joi.object().keys({
		phone_number: Joi.string().required(),
		name: Joi.string().optional().allow(null),
		email: Joi.string().optional().allow('').allow(null),
		country_code: Joi.string().optional().allow(null),
		tags: Joi.array().items(Joi.string()).optional().allow(null),
		attributes: Joi.object().pattern(Joi.string(), Joi.string()).optional().allow(null),
	}),
	tags: Joi.object().keys({
		tags: Joi.array().items(Joi.string()).required(),
	}),
	get_contact_tags: Joi.object().keys({
		search: Joi.string().optional().allow(''),
	}),
	getContacts: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		phone_numbers_only: Joi.boolean().optional().allow(null),
		tags: Joi.array().items(Joi.string()).optional().allow(null),
		excluded_tags: Joi.array().items(Joi.string()).optional().allow(null),
		sort: Joi.string().optional().allow(''),
		sortDirection: Joi.string().valid('asc', 'desc').optional(),
	}).concat(apiSchema.paginated),
	id: Joi.object().keys({
		id: Joi.string().required(),
	}),
	bulkCreateContacts: Joi.object({
		country_code: Joi.string().required(),
		tags: Joi.array().items(Joi.string()).optional().allow(null),
		contacts: Joi.object({
			originalname: Joi.string().required().pattern(/\.csv$/).label('CSV file'),
			mimetype: Joi.string().valid('text/csv').required(),
		}).unknown(true),
		activeHeaders: Joi.object()
			.pattern(Joi.string(), Joi.string())
			.required()
			.custom((value, helpers) => {
				if (typeof value === 'string') {
					try {
						return JSON.parse(value)
					} catch (error) {
						return helpers.error('any.invalid')
					}
				}
				return value
			}, 'Parse JSON')
			.messages({
				'any.invalid': 'activeHeaders must be a valid JSON string',
				'any.required': 'activeHeaders is a required field',
			}),
	}),
	bulkDeleteContacts: Joi.object().keys({
		ids: Joi.array().items(Joi.string().required()).required(),
		selectAllActive: Joi.boolean().required(),
	}),
	bulkModifyTags: Joi.object().keys({
		ids: Joi.array().items(Joi.string().required()).required(),
		tags: Joi.array().items(Joi.string().required()).required(),
		selectAllActive: Joi.boolean().required(),
	}),
	callContact: Joi.object().keys({
		contact_id: Joi.string().required(),
		interview_id: Joi.string().required(),
		metadata: Joi.object().pattern(Joi.string(), Joi.string()).optional().allow(null),
	}),
	getContactCount: Joi.object().keys({
		tags: Joi.array().items(Joi.string()).optional().allow(null),
		excluded_tags: Joi.array().items(Joi.string()).optional().allow(null),
		contacts: Joi.array().items(Joi.string()).optional().allow(null),
		search_type: Joi.string().optional().allow(null).allow(''),
	}),
	addAttribute: Joi.object().keys({
		ids: Joi.array().items(Joi.string().required()).required(),
		key: Joi.string().required(),
		value: Joi.any().required(),
	}),
	removeAttribute: Joi.object().keys({
		ids: Joi.array().items(Joi.string().required()).required(),
		key: Joi.string().required(),
	}),
	updateContactInfo: Joi.object().keys({
		phone_number: Joi.string().optional().allow(''),
		name: Joi.string().optional().allow(''),
		email: Joi.string().optional().allow(''),
		country_code: Joi.string().optional().allow(null).allow(''),
	}),
}

export default contactSchema
