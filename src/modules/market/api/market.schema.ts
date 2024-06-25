import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'

const marketSchema = {
	create: Joi.object().keys({
		description: Joi.string().required(),
		listing_name: Joi.string().required(),
		interview_id: Joi.string().required(),
		price: Joi.number().optional(),
		tags: Joi.array().items(Joi.string()).optional(),
		image_url: Joi.string().optional().allow(''),
		interview_response_id: Joi.string().optional().allow(''),
	}),
	update: Joi.object().keys({
		description: Joi.string().optional().allow(''),
		listing_name: Joi.string().optional().allow(''),
		price: Joi.number().optional(),
		tags: Joi.array().items(Joi.string()).optional(),
		image_url: Joi.string().optional().allow(''),
		interview_response_id: Joi.string().optional().allow(''),
	}),
	getAll: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		sort: Joi.string().valid('name_asc', 'name_desc', 'created_asc', 'created_desc').optional(),
	}).concat(apiSchema.paginated),
	buy: Joi.object().keys({
		should_include_genius: Joi.boolean().optional(),
	}),
	id: Joi.object().keys({
		market_id: Joi.string().uuid().required(),
	}),
}

export default marketSchema
