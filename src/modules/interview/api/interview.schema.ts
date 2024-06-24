/* eslint-disable max-len */
import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { InterviewType } from '../db/interview.types'

const interviewSchema = {
	create: Joi.object().keys({
		type: enumToJoiSchema(InterviewType).required(),
		title: Joi.string().optional().allow(''),
		genius_id: Joi.string().optional().allow(''),
	}),
	id: Joi.object().keys({
		interview_id: Joi.string().required(),
	}),
	update: Joi.object().keys({
		ai_name: Joi.string().optional().allow(''),
		note_to_subject: Joi.string().optional().allow(''),
		title: Joi.string().optional().allow(''),
		notifications: Joi.boolean().optional().allow(''),
		should_record: Joi.boolean().optional().allow(''),
		should_leave_voicemail: Joi.boolean().optional().allow(''),
		voicemail_message: Joi.string().optional().allow(''),
	}),
	getInterviews: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		status: Joi.string().valid('ACTIVE', 'ARCHIVED').optional(),
		sort: Joi.string().valid('title_asc', 'title_desc', 'created_asc', 'created_desc').optional(),
		all_interviews: Joi.boolean().optional().allow(null),
	}).concat(apiSchema.paginated),
	getInterviewResponses: Joi.object().keys({
		search: Joi.string().optional().allow(''),
		response_tags: Joi.array().items(Joi.string()).optional(),
		status: Joi.array().items(Joi.string()).optional(),
		job_id: Joi.string().optional().allow(''),
	}).concat(apiSchema.paginated),
	copy: Joi.object().keys({
		title: Joi.string().required(),
		team_id: Joi.string().required(),
		folder_id: Joi.string().optional().allow(''),
	}),
	importScript: Joi.object().keys({
		script: Joi.string().required(),
		title: Joi.string().required(),
		type: enumToJoiSchema(InterviewType).required(),
	}),
	tag: Joi.object().keys({
		response_tag: Joi.string().required(),
	}),
	getInterviewPreviewAudio: Joi.object().keys({
		text: Joi.string().required(),
		ai_name: Joi.string().required(),
	}),
	getInsights: Joi.object().keys({
		time_frame: Joi.string().valid('day', 'week', 'month', 'all time').optional(),
		filtered_metric: Joi.object({
			icon: Joi.string().required(),
			color: Joi.string().required(),
			description: Joi.string().required(),
			value: Joi.string().required(),
			method: Joi.string().valid('sum', 'average', 'percentage', 'percentage_total_responses', 'percentage_ended').required(),
			base: Joi.string().optional(),
			type: Joi.string().valid('status', 'tag').required(),
			number_value: Joi.number().optional(),
			index: Joi.number().required(),
		}).optional(),
		search: Joi.string().optional().allow(''),
	}),
	exportReport: Joi.object().keys({
		time_frame: Joi.string().valid('day', 'week', 'month', 'all time').optional(),
	}),
	updateInsights: Joi.object().keys({
		metrics: Joi.array().items(Joi.object({
			icon: Joi.string().required(),
			color: Joi.string().required(),
			description: Joi.string().required(),
			value: Joi.string().required(),
			method: Joi.string().valid('sum', 'percentage', 'average', 'percentage_total_responses', 'percentage_ended').required(),
			base: Joi.string().optional(),
			type: Joi.string().valid('status', 'tag').required(),
			number_value: Joi.number().optional(),
			index: Joi.number().required(),
		})),
	}),
}

export default interviewSchema
