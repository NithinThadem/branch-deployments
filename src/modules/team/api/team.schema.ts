import * as Joi from 'joi'

const teamSchema = {
	create: Joi.object().keys({
		name: Joi.string().optional().allow(''),
	}),
	onboarding: Joi.object().keys({
		name: Joi.string().optional().allow(''),
		first_name: Joi.string().required(),
		last_name: Joi.string().required(),
	}),
	inviteUser: Joi.object().keys({
		email: Joi.string().email().required(),
	}),
	updateTeam: Joi.object().keys({
		name: Joi.string().min(3).optional().allow(''),
		name_pronunciation: Joi.string().optional().allow(''),
	}),
	deleteUser: Joi.object().keys({
		user_id: Joi.string().required(),
	}),
	teamId: Joi.object().keys({
		team_id: Joi.string().required(),
	}),
	dataPointsQuery: Joi.object().keys({
		start_date: Joi.date().optional(),
		end_date: Joi.date().optional(),
		medium: Joi.array().items(Joi.string()).optional(),
		job_id: Joi.string().optional(),
		interview_id: Joi.string().optional(),
		time_frame: Joi.string().valid('day', 'week', 'month').optional(),
	}),
	createContactView: Joi.object().keys({
		teamId: Joi.string().required(),
		viewName: Joi.string().required(),
		attributeKeys: Joi.array().items(Joi.string().required()).required(),
	}),
	deleteContactView: Joi.object().keys({
		teamId: Joi.string().required(),
		viewName: Joi.string().required(),
	}),
	updateContactView: Joi.object().keys({
		teamId: Joi.string().required(),
		viewName: Joi.string().required(),
		newViewName: Joi.string().optional(),
		newAttributeKeys: Joi.array().items(Joi.string().required()).optional(),
	}),
	submitBusinessMetadata: Joi.object().keys({
		name: Joi.string().required(),
		type: Joi.string().required(),
		industry: Joi.string().required(),
		registration_id_type: Joi.string().required(),
		registration_number: Joi.string().required(),
		regions_of_operation: Joi.string().required(),
		website_url: Joi.string().required(),
		address: Joi.object().keys({
			line_1: Joi.string().required(),
			line_2: Joi.string().optional().allow(''),
			city: Joi.string().required(),
			state: Joi.string().required(),
			postal_code: Joi.string().required(),
			country: Joi.string().required(),
		}).required(),
		authorized_signatory: Joi.object().keys({
			title: Joi.string().required(),
			first_name: Joi.string().required(),
			last_name: Joi.string().required(),
		}).required(),
		company_type: Joi.string().required(),
		stock_exchange: Joi.string().optional().allow(''),
		stock_ticker: Joi.string().optional().allow(''),
		campaign_data: Joi.object().keys({
			description: Joi.string().required(),
			message_flow: Joi.string().required(),
			usecase: Joi.string().required(),
			message_samples: Joi.array().items(Joi.string()).required(),
			has_embedded_links: Joi.boolean().required(),
			has_embedded_phone: Joi.boolean().required(),
			opt_in_message: Joi.string().optional().allow(''),
			opt_out_message: Joi.string().optional().allow(''),
			help_message: Joi.string().optional().allow(''),
			opt_in_keywords: Joi.array().items(Joi.string()).optional().allow(null),
			opt_out_keywords: Joi.array().items(Joi.string()).optional().allow(null),
			help_keywords: Joi.array().items(Joi.string()).optional().allow(null),
		}),
	}),
}

export default teamSchema
