/* eslint-disable max-len */
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { InterviewEntity } from '../db/interview.entity'
import dataSource from '../../../services/database/data-source'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import {
	InterviewStatus, InterviewType, MetricDetails, MetricType,
} from '../db/interview.types'
import { DataPointEntity } from '../../data-point/db/data-point.entity'
import { InterviewFlowEntity } from '../../interview-flow/db/interview-flow.entity'
import { GeniusEntity } from '../../genius/db/genius.entity'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { transformScript } from '../../interview-flow/db/interview-flow.helpers'
import { calculateMetrics, convertTextScriptToFlow, synthesizeSpeech } from './interview.helpers'
import analytics from '../../../services/segment'
import { redisRead, redisWrite } from '../../../services/redis'
import { captureError } from '../../../util/error.util'
import { InterviewFolderEntity } from '../../interview-folder/db/interview-folder.entity'
import { uploadFile } from '../../../services/google/storage'
import { hash } from 'typeorm/util/StringUtils'
import { Brackets } from 'typeorm'
import moment from 'moment'

export const createInterview = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const genius_id = req.body.genius_id

	const interview = await InterviewEntity.create({
		team: {
			id: req.headers.team_id,
		},
		title: req.body.title,
		type: req.body.type,
		genius_id: genius_id,
	}).save()

	await InterviewFlowEntity.createFlowFromType(interview.id, req.body.type).save()

	if (req.body.type === InterviewType.SALES && genius_id) {
		const genius = await GeniusEntity.findOneOrFail({
			where: {
				id: genius_id,
			},
		})
		if (genius) {
			interview.genius = genius
			await interview.save()
		}
	}
	await interview.save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Thoughtly Created',
			properties: {
				distinct_id: user.email,
				$ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
				title: interview.title,
				type: interview.type,
				creation_type: 'Blank',
				team_id: interview.team.id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: interview })
}

export const update = async (req: AuthenticatedRequest, res: Response) => {
	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: req.params.interview_id,
		},
		relations: ['team'],
	})

	if (req.body.ai_name) {
		interview.ai_name = req.body.ai_name
	}

	if ('notifications' in req.body) {
		interview.notifications = req.body.notifications
	}

	if (req.body.note_to_subject) {
		interview.note_to_subject = req.body.note_to_subject
	}

	if (req.body.title) {
		interview.title = req.body.title
	}

	if ('should_record' in req.body) {
		interview.should_record = req.body.should_record
	}

	if ('should_leave_voicemail' in req.body) {
		interview.should_leave_voicemail = req.body.should_leave_voicemail
	}

	if (req.body.voicemail_message) {
		interview.voicemail_message = req.body.voicemail_message
	}

	await interview.save()

	return response({ res, data: interview })
}

export const getInterviews = async (req: AuthenticatedRequest, res: Response) => {
	const searchText = req.query.search || ''
	const status = req.query.status
	const sort = req.query.sort || 'created_desc'
	const resultsPerPage = req.query.limit || 25
	const page = req.query.page || 0
	const allInterviews = req.query.all_interviews || false

	let orderByField = 'interview.created'
	let orderByDirection: 'ASC' | 'DESC' = 'DESC'

	switch (sort) {
		case 'title_asc':
			orderByField = 'interview.title'
			orderByDirection = 'ASC'
			break
		case 'title_desc':
			orderByField = 'interview.title'
			orderByDirection = 'DESC'
			break
		case 'created_asc':
			orderByField = 'interview.created'
			orderByDirection = 'ASC'
			break
		case 'created_desc':
		default:
			orderByField = 'interview.created'
			orderByDirection = 'DESC'
			break
	}

	const count = await dataSource
		.createQueryBuilder(InterviewEntity, 'interview')
		.where('interview.team.id = :teamId', { teamId: req.headers.team_id })
		.andWhere('interview.title ILike :searchText', { searchText: `%${searchText}%` })
		.andWhere('interview.status = :status', { status: status })
		.getCount()

	let query = dataSource
		.createQueryBuilder(InterviewEntity, 'interview')
		.leftJoinAndSelect('interview.inbound_phone_number', 'inboundPhoneNumber')
		.leftJoinAndSelect('interview.outbound_phone_number', 'outboundPhoneNumber')
		.addSelect(['COUNT(response.id) as response_count'])
		.leftJoin('interview.responses', 'response')
		.where('interview.team.id = :teamId', { teamId: req.headers.team_id })
		.andWhere('interview.title ILike :searchText', { searchText: `%${searchText}%` })

	if (status) {
		query = query.andWhere('interview.status = :status', { status })
	}

	if (!allInterviews) {
		query = query.andWhere('interview.folder_id IS NULL')
	}

	const { entities, raw } = await query
		.groupBy('interview.id')
		.addGroupBy('inboundPhoneNumber.id')
		.addGroupBy('outboundPhoneNumber.id')
		.orderBy(orderByField, orderByDirection)
		.take(resultsPerPage)
		.skip(page * resultsPerPage)
		.getRawAndEntities()

	for (const entity of entities) {
		(entity as any).response_count = raw[entities.indexOf(entity)].response_count;
		(entity as any).connected_users = JSON.parse(await redisRead(`interview-${entity.id}-users`) || '[]')
	}

	return response({
		res, data: {
			interviews: entities,
			count,
		},
	})
}

export const getAvailableInterviews = async (req: AuthenticatedRequest, res: Response) => {
	const interviews = await dataSource
		.createQueryBuilder(InterviewEntity, 'interview')
		.where('interview.team.id = :teamId', { teamId: req.headers.team_id })
		.getMany()

	return response({
		res, data: interviews,
	})
}

export const getInterviewResponses = async (req: AuthenticatedRequest, res: Response) => {
	const take = req.query.limit || 25
	const search = req.query.search || ''
	const tags = req.query.response_tags || []
	const status = req.query.status || []
	const jobId = req.query.job_id || ''

	let query = dataSource
		.createQueryBuilder(InterviewResponseEntity, 'response')
		.innerJoinAndSelect('response.contact', 'contact')
		.where('response.interview.id = :interviewId', { interviewId: req.params.interview_id })

	if (jobId) {
		query = query
			.innerJoin('response.job', 'job')
			.andWhere('job.id = :jobId', { jobId })
	}

	if (search) {
		query = query.andWhere('contact.name ILike :search', { search: `%${search}%` })
	}

	if (status.length > 0) {
		query = query.andWhere('response.status IN (:...status)', { status })
	}

	if (tags.length > 0) {
		const lowercasedTags = tags.map(tag => tag.toLowerCase())
		query = query.andWhere(`
            EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(response.summary_data->'response_tags') AS db_tag
                WHERE LOWER(db_tag) = ANY(:lowercasedTags)
            )
        `, { lowercasedTags })
	}

	const allTagsQuery = dataSource
		.createQueryBuilder(InterviewResponseEntity, 'response')
		.select('jsonb_array_elements_text(response.summary_data->\'response_tags\')', 'tag')
		.where('response.interview.id = :interviewId', { interviewId: req.params.interview_id })
		.distinct(true)

	const [count, responses, allTagsResult] = await Promise.all([
		query.getCount(),
		query
			.orderBy('response.created', 'DESC')
			.take(take)
			.skip((req.query.page || 0) * take)
			.getMany(),
		allTagsQuery.getRawMany(),
	])

	const allTags = allTagsResult.map(result => result.tag)

	return response({
		res,
		data: {
			responses: responses?.map(r => r.toPublic()),
			count,
			all_response_tags: allTags,
		},
	})
}

export const getInterview = async (req: AuthenticatedRequest, res: Response) => {
	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: req.params.interview_id,
		},
		relations: ['flow', 'inbound_phone_number', 'outbound_phone_number'],
	})

	const responseCount = await InterviewResponseEntity.count({
		where: {
			interview: {
				id: req.params.interview_id,
			},
		},
	})

	return response({
		res,
		data: {
			interview,
			count: responseCount,
		},
	})
}

export const toggleArchiveInterview = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const interview = await InterviewEntity.findOneOrFail({
			where: {
				id: req.params.interview_id,
			},
			relations: ['flow', 'inbound_phone_number', 'outbound_phone_number'],
		})

		interview.status = interview.status === InterviewStatus.ACTIVE ? InterviewStatus.ARCHIVED : InterviewStatus.ACTIVE
		await interview.save()

		return response({ res, data: interview })
	} catch (error) {
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getDataPoints = async (req: AuthenticatedRequest, res: Response) => {
	const queryBuilder = dataSource.getRepository(DataPointEntity)
		.createQueryBuilder('data_point')
		.select('data_point.question_number', 'question_number')
		.addSelect('data_point.answer', 'answer')
		.addSelect('COUNT(data_point.id)', 'count')
		.groupBy('data_point.question_number')
		.addGroupBy('data_point.answer')
		.orderBy('data_point.question_number', 'ASC')
		.addOrderBy('count', 'DESC')

	const result = await queryBuilder.getRawMany()

	const groupedData = {}

	result.forEach((row) => {
		const { question_number, answer, count } = row
		if (!groupedData[question_number]) {
			groupedData[question_number] = []
		}
		groupedData[question_number].push({ answer, count })
	})

	const outputArray = Object.keys(groupedData).map((question_number) => ({
		question_number: parseInt(question_number),
		answers: groupedData[question_number].slice(0, 25),
	}))

	return response({ res, data: outputArray })
}

export const copyInterviewFlow = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const { team_id, folder_id, title } = req.body
	const interview_id = req.params.interview_id

	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: interview_id,
		},
		relations: ['flow', 'team'],
	})

	const currentFlow = interview.flow

	const newInterview = await InterviewEntity.create({
		team: { id: team_id || interview.team.id },
		title: title || interview.title,
		type: interview.type,
		folder: folder_id ? { id: folder_id } : undefined,
		version: interview.version,
		genius_id: interview.genius_id,
		ai_name: interview.ai_name,
		lang: interview.lang,
		error_id: interview.error_id,
		note_to_subject: interview.note_to_subject,
		notifications: interview.notifications,
		response_tags: interview.response_tags,
		presence_interim_audio: interview.presence_interim_audio,
		presence_background_audio: interview.presence_background_audio,
		personality_customization: interview.personality_customization,
		should_record: interview.should_record,

	}).save()

	const newFlow = InterviewFlowEntity.create({
		interview_id: newInterview.id,
		nodes: currentFlow.nodes,
		edges: currentFlow.edges,
		functions: currentFlow.functions,
	})
	await newFlow.save()

	analytics.track({
		userId: user.id,
		event: 'Thoughtly Flow Copied',
		properties: {
			new_interview_id: newInterview.id,
			old_interview_id: interview_id,
			team_id: team_id || interview.team.id,
			folder_id: folder_id,
		},
	})

	return response({ res, data: newInterview })
}

export const copyInterviews = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const interviewIds = req.body.interview_ids
	const teamId = req.headers.team_id
	const folderId = req.body.folder_id

	const interviews = await dataSource
		.getRepository(InterviewEntity)
		.createQueryBuilder('interview')
		.where('interview.id IN (:...interviewIds)', { interviewIds })
		.andWhere('interview.team.id = :teamId', { teamId })
		.getMany()

	if (interviews.length !== interviewIds.length) {
		return response({ res, status: 403, error: 'Forbidden: Interview IDs belong to a different team' })
	}

	if (folderId) {
		const folder = await InterviewFolderEntity.findOneOrFail({
			where: {
				id: folderId,
				team: {
					id: teamId,
				},
			},
		})

		for (const interview of interviews) {
			if (interview.folder && interview.folder.id === folder.id) {
				continue
			}

			interview.folder = folder
			await interview.save()
		}
	} else {
		const newTeamId = req.body.team_id || teamId
		for (const interview of interviews) {
			const newInterview = InterviewEntity.create({
				team: {
					id: newTeamId,
				},
				title: interview.title,
				type: interview.type,
			})
			await newInterview.save()

			if (interview.flow) {
				const newFlow = InterviewFlowEntity.create({
					interview_id: newInterview.id,
					nodes: interview.flow.nodes,
					edges: interview.flow.edges,
					functions: interview.flow.functions,
				})
				await newFlow.save()
			}
		}
	}

	analytics.track({
		userId: user.id,
		event: 'Thoughtly Copied',
		properties: {
			interview_ids: interviewIds,
			team_id: teamId,
			folder_id: folderId,
		},
	})

	return response({ res, data: { message: 'Interviews added to folder successfully' } })
}

export const getInterviewFeedback = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: req.params.interview_id,
		},
		relations: ['flow', 'team'],
	})

	const currentFlow = interview.flow

	if (!currentFlow) {
		return response({ res, status: 404, error: 'Interview flow not found' })
	}

	const script = transformScript(interview)
		.replace(/STEP \d+: /g, '')

	const data = await withExponentialBackoff(() => azureAi({
		'Helicone-Property-Feature': 'Feedback',
		'Helicone-Property-InterviewId': interview.id,
		team_id: req.headers.team_id,
		model: AzureOpenAIModels.GPT_3_5_TURBO_1106,
	}).chat.completions.create({
		model: OpenAIModels.GPT_3_5_TURBO_1106,
		messages: [{
			role: 'system',
			// eslint-disable-next-line max-len
			content: `The following is a ${interview.type} phone call script used to instruct a Thoughtly AI agent on how to have a conversation with a customer about a given topic. Keeping in mind the goal of the call, provide feedback that will increase the chances for this call to be successful. Provide tangible changes to the script with examples.\n\n${script}`,
		}],
	}))

	analytics.track({
		userId: user.id,
		event: 'Thoughtly Feedback Requested',
		properties: {
			interview_id: req.params.interview_id,
			team_id: req.headers.team_id,
		},
	})

	return response({ res, data: data.choices[0].message.content })
}

export const importScript = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const { nodes, edges } = await withExponentialBackoff(() => convertTextScriptToFlow(req.body.script, req.headers.team_id))

	const interview = await InterviewEntity.create({
		team: {
			id: req.headers.team_id,
		},
		title: req.body.title,
		type: InterviewType.SALES,
	}).save()

	const flow = InterviewFlowEntity.create({
		interview_id: interview.id,
		nodes,
		edges,
	})

	await flow.save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Thoughtly Created',
			properties: {
				distinct_id: user.email,
				$ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
				title: interview.title,
				type: interview.type,
				creation_type: 'Import Script',
				team_id: interview.team.id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: interview })
}

export const addResponseTagToInterviewResponse = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const interviewId = req.params.interview_id
		const { response_tag } = req.body

		const interview = await InterviewEntity.findOneOrFail({ where: { id: interviewId } })

		if (!interview.response_tags) {
			interview.response_tags = []
		}

		if (!interview.response_tags.includes(response_tag)) {
			interview.response_tags.push(response_tag)
			await interview.save()
		}

		return response({ res, data: interview })
	} catch (error) {
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const deleteResponseTagToInterviewResponse = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const interviewId = req.params.interview_id
		const { response_tag } = req.body

		const interview = await InterviewEntity.findOneOrFail({ where: { id: interviewId } })

		if (interview.response_tags) {
			interview.response_tags = interview.response_tags.filter(t => t !== response_tag)
			await interview.save()
		}

		return response({ res, data: interview })
	} catch (error) {
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getInterviewPreviewAudio = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const { text, ai_name } = req.body

		const hashKey = hash(`${text}-${ai_name}`, { length: 8 })

		const url = await redisRead(`message_${hashKey}`)

		if (url) {
			return response({ res, data: { url } })
		}

		const audioBuffer = await synthesizeSpeech(text, ai_name)
		const aiAudioFileUrl = await uploadFile('mp3', audioBuffer)

		await redisWrite(`message_${hashKey}`, aiAudioFileUrl, { EX: 60 * 60 * 24 })
		return response({ res, data: { url: aiAudioFileUrl } })
	} catch (error) {
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getInterviewInsights = async (req: AuthenticatedRequest, res: Response) => {
	const interviewId = req.params.id
	const timeFrame = req.query.time_frame || 'month'
	const filteredMetric: MetricDetails = req.query.filtered_metric || null
	const search = req.query.search
	const take = parseInt(req.query.limit) || 20
	const page = parseInt(req.query.page) || 0

	let startDate: moment.Moment | undefined
	const endDate = new Date()
	switch (timeFrame) {
		case 'day':
			startDate = moment(endDate).subtract(1, 'days').startOf('day')
			break
		case 'week':
			startDate = moment(endDate).subtract(1, 'weeks').startOf('isoWeek')
			break
		case 'month':
			startDate = moment(endDate).subtract(1, 'months').startOf('month')
			break
		case 'all time':
			startDate = undefined
			break
	}

	const formattedStartDate = startDate ? startDate.toISOString() : undefined
	const formattedEndDate = endDate.toISOString()

	const interview = await InterviewEntity.findOneOrFail({ where: { id: interviewId } })
	const report = interview.metrics

	const responsesQuery = dataSource
		.createQueryBuilder(InterviewResponseEntity, 'response')
		.innerJoinAndSelect('response.contact', 'contact')
		.where('response.interview.id = :interviewId', { interviewId: req.params.interview_id })

	if (startDate) {
		responsesQuery.andWhere('response.created >= :start AND response.created <= :end', { start: formattedStartDate, end: formattedEndDate })
	}

	if (filteredMetric) {
		switch (filteredMetric.type) {
			case MetricType.STATUS:
				switch (filteredMetric.value.toUpperCase()) {
					case 'TOTAL_RESPONSES':
						break
					case 'DURATION':
						responsesQuery.orderBy('response.duration_ms', 'DESC')
						break
					case 'PICKUP_RATE':
						responsesQuery.andWhere('response.status IN (:...statuses)', { statuses: ['ENDED', 'TRANSFERRED'] })
						break
					default:
						responsesQuery.andWhere('response.status = :status', { status: filteredMetric.value })
						break
				}
				break
			case MetricType.TAG:
				responsesQuery.andWhere("response.summary_data->'response_tags' @> :tag", { tag: JSON.stringify([filteredMetric.value]) })
				break
		}
	}

	if (search) {
		responsesQuery.andWhere(new Brackets(qb => {
			qb.where('contact.lead_source ILIKE :search', { search: `%${search}%` })
				.orWhere('contact.name ILIKE :search', { search: `%${search}%` })
		}))
	}

	const metricsQuery = dataSource
		.createQueryBuilder(InterviewResponseEntity, 'response')
		.innerJoinAndSelect('response.contact', 'contact')
		.where('response.interview.id = :interviewId', { interviewId: req.params.interview_id })

	if (startDate) {
		metricsQuery.andWhere('response.created >= :start AND response.created <= :end', { start: formattedStartDate, end: formattedEndDate })
	}

	const allTagsQuery = dataSource
		.createQueryBuilder()
		.select('DISTINCT jsonb_array_elements_text(response.summary_data->\'response_tags\')', 'tag')
		.from(InterviewResponseEntity, 'response')
		.innerJoin('response.contact', 'contact')
		.where('response.interview_id = :interviewId', { interviewId })
		.andWhere('contact.id IS NOT NULL')

		.where('response.interview_id = :interviewId', { interviewId })

	if (startDate) {
		allTagsQuery.andWhere('response.created >= :start AND response.created <= :end', { start: formattedStartDate, end: formattedEndDate })
	}

	const [responses, metricsData, allTags] = await Promise.all([
		responsesQuery
			.orderBy('response.created', 'DESC')
			.take(take)
			.skip(page * take)
			.getMany(),
		metricsQuery.getMany(),
		allTagsQuery.getRawMany(),
	])

	const totalCount = await responsesQuery.getCount()
	const metrics = calculateMetrics(report, metricsData)

	return response({
		res,
		data: {
			metrics,
			responses: responses.map(r => r.toPublic()),
			count: totalCount,
			allTags: allTags.map(t => t.tag),
		},
	})
}

export const exportInterviewInsights = async (req: AuthenticatedRequest, res: Response) => {
	const interviewId = req.params.id
	const timeFrame = req.query.time_frame || 'month'

	let startDate: moment.Moment | undefined
	const endDate = new Date()
	switch (timeFrame) {
		case 'day':
			startDate = moment(endDate).subtract(1, 'days').startOf('day')
			break
		case 'week':
			startDate = moment(endDate).subtract(1, 'weeks').startOf('isoWeek')
			break
		case 'month':
			startDate = moment(endDate).subtract(1, 'months').startOf('month')
			break
		case 'all time':
			startDate = undefined
			break
	}

	const formattedStartDate = startDate ? startDate.toISOString() : undefined
	const formattedEndDate = endDate.toISOString()
	const interview = await InterviewEntity.findOneOrFail({ where: { id: interviewId } })

	const report = interview.metrics

	const metricsDetails = await Promise.all(report.map(async metric => {
		const queryBuilder = dataSource.getRepository(InterviewResponseEntity)
			.createQueryBuilder('response')
			.innerJoinAndSelect('response.contact', 'contact')
			.innerJoinAndSelect('response.interview', 'interview')
			.where('response.interview_id = :interviewId', { interviewId })

		if (startDate) {
			queryBuilder.andWhere('response.created >= :start AND response.created <= :end', { start: formattedStartDate, end: formattedEndDate })
		}

		switch (metric.type) {
			case MetricType.STATUS:
				switch (metric.value.toUpperCase()) {
					case 'TOTAL_RESPONSES':
						break
					case 'DURATION':
						queryBuilder.orderBy('response.duration_ms', 'DESC')
						break
					case 'PICKUP_RATE':
						queryBuilder.andWhere('response.status IN (:...statuses)', { statuses: ['ENDED', 'TRANSFERRED'] })
						break
					default:
						queryBuilder.andWhere('response.status = :status', { status: metric.value })
						break
				}
				break
			case MetricType.TAG:
				queryBuilder.andWhere("response.summary_data->'response_tags' @> :tag", { tag: JSON.stringify([metric.value]) })
				break
		}

		// Execute the query and get the results
		const responses = await queryBuilder.getMany()

		// Calculate metrics based on the responses
		const metrics = calculateMetrics([metric], responses)

		return {
			filteredMetric: metric.description,
			metrics: metrics,
			responses: responses.map(r => r.toPublic()),
		}
	}))

	return response({
		res,
		data: metricsDetails,
	})
}

export const updateInterviewInsights = async (req: AuthenticatedRequest, res: Response) => {
	const interviewId = req.params.id
	const { metrics } = req.body

	const interview = await InterviewEntity.findOneOrFail({ where: { id: interviewId } })

	const report = interview.metrics

	if (!report) {
		return res.status(404).json({ message: 'Report not found' })
	}

	interview.metrics = metrics || report

	await interview.save()
	return res.status(200).json({ data: report })
}
