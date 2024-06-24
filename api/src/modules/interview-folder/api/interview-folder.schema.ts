import * as Joi from 'joi'

const interviewFolderSchema = {
	createFolder: Joi.object().keys({
		name: Joi.string().required(),
	}),
	folder_id: Joi.object().keys({
		folder_id: Joi.string().required(),
	}),
	interview_id: Joi.object().keys({
		interview_id: Joi.string().required(),
	}),
	get_interviews: Joi.object().keys({
		search: Joi.string().allow('', null),
		status: Joi.string().valid('ACTIVE', 'ARCHIVED').optional(),
		sort: Joi.string().default('created_desc'),
		limit: Joi.number().integer().default(25),
		page: Joi.number().integer().default(0),
		folders_only: Joi.boolean().truthy('true').falsy('false').default(true),
	}),
	get_folders: Joi.object().keys({
		search: Joi.string().allow('', null),
		team_id: Joi.string().optional(),
	}),
	copyFolder: Joi.object().keys({
		team_id: Joi.string().optional(),
		folder_name: Joi.string().required(),
	}),
}

export default interviewFolderSchema
