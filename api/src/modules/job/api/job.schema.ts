import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { JobType } from '../db/job.types'

const jobSchema = {
	create: Joi.object().keys({
		interview_id: Joi.string().optional().allow(null),
		type: enumToJoiSchema(JobType).required(),
		rdd_config: Joi.object().keys({
			phone_blocks: Joi.array().items(Joi.object().keys({
				npa: Joi.number().required(),
				nxx: Joi.number().optional().allow(null),
			})).required(),
			sample_interval: Joi.number().required(),
		}).optional().allow(null),
		num_contacts: Joi.number().optional().allow(null),
		tags: Joi.array().items(Joi.string()).optional().allow(null),
		excluded_tags: Joi.array().items(Joi.string()).optional().allow(null),
	}),
	createResponsesJob: Joi.object().keys({
		interview_id: Joi.string().required(),
		contact_ids: Joi.array().items(Joi.string()),
		select_all: Joi.boolean(),
		status_filter: Joi.array().items(Joi.string()),
		tag_filter: Joi.array().items(Joi.string()),
		job_id: Joi.string().optional().allow(null).allow(''),
		type: Joi.string().optional().allow(null).allow(''),
	}),
	createJobByContacts: Joi.object({
		interview_id: Joi.string().required(),
		contact_ids: Joi.array().items(Joi.string()).optional(),
		phone_numbers: Joi.array().items(Joi.string()).optional(),
		country_code: Joi.string().optional(),
	}).or('contact_ids', 'phone_numbers'),
	getJobs: Joi.object().keys({
		interview_id: Joi.string().optional().allow(null),
	}).concat(apiSchema.paginated),
	id: Joi.object().keys({
		id: Joi.string().required(),
	}),
}

export default jobSchema
