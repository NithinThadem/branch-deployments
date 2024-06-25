import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import { WebhookEntity } from '../db/webhook.entity'
import response from '../../../services/server/response'
import { getInterviewOrFolderName } from '../db/webhook.helpers'
import { UserEntity } from '../../../modules/user/db/user.entity'
import * as moment from 'moment'
import { In } from 'typeorm'

export const subscribeWebhook = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	await WebhookEntity.create({
		user,
		team: {
			id: req.headers.team_id,
		},
		type: req.body.type,
		data: req.body.data,
		url: req.body.url,
	}).save()

	return response({ res })
}

export const unsubscribeWebhook = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	await WebhookEntity.delete({
		user,
		team: {
			id: req.headers.team_id,
		},
		type: req.body.type,
		data: req.body.data,
		url: req.body.url,
	})

	return response({ res })
}

export const bulkSubscribeWebhooks = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const data = req.body.data
	const created = moment()

	await Promise.all(data.map(async (interview_id) => WebhookEntity.create({
		user,
		team: {
			id: req.headers.team_id,
		},
		type: req.body.type,
		data: interview_id,
		url: req.body.url,
		created,
	}).save()))

	return response({ res })
}

export const bulkUnsubscribeWebhooks = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const ids = req.body.ids

	await WebhookEntity.delete({
		user,
		team: {
			id: req.headers.team_id,
		},
		id: In(ids),
	})

	return response({ res })
}

export const bulkUpdateWebhooks = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const ids = req.body.ids
	const url = req.body.url
	const type = req.body.type

	if (!url && !type) {
		return response({ res, status: 400, error: 'At least one field is required: either webhook URL or type.' })
	}

	await WebhookEntity.update({
		user,
		team: {
			id: req.headers.team_id,
		},
		id: In(ids),
	}, {
		...(url && { url }),
		...(type && { type }),
	})

	return response({ res })
}

export const getGroupedWebhooks = async (req: AuthenticatedRequest, res: Response) => {
	const page = req.query.page || 0
	const pageSize = req.query.limit || 10

	const queryBuilder = WebhookEntity
		.createQueryBuilder('webhook')
		.select([
			'webhook.user_id',
			'webhook.team_id',
			'webhook.created as created',
			'webhook.type as type',
			'webhook.url as url',
			'ARRAY_AGG(webhook.data) as data',
			'ARRAY_AGG(webhook.id) as ids',
		])
		.where('webhook.team_id = :teamId', { teamId: req.headers.team_id })
		.groupBy('webhook.user_id')
		.addGroupBy('webhook.team_id')
		.addGroupBy('webhook.type')
		.addGroupBy('webhook.url')
		.addGroupBy('webhook.created')
		.orderBy('webhook.created', 'DESC')
		.take(pageSize)
		.skip(page * pageSize)

	const [result, countQuery] = await Promise.all([
		queryBuilder.getRawMany(),
		WebhookEntity
			.createQueryBuilder('webhook')
			.distinctOn(['webhook.team_id', 'webhook.user_id', 'webhook.type', 'webhook.url', 'webhook.created'])
			.where('webhook.team_id = :teamId', { teamId: req.headers.team_id })
			.getRawMany(),
	])

	return response({
		res,
		data: {
			responses: await Promise.all(result.map(async (webhook) => {
				const interviewOrFolderNames = await Promise.all(webhook.data.map(async (data) =>
					getInterviewOrFolderName(data)))
				return {
					ids: webhook.ids,
					created: webhook.created,
					user: await UserEntity.findOneOrFail({ where: { id: webhook.user_id } }),
					team: webhook.team_id,
					type: webhook.type,
					data: webhook.data,
					url: webhook.url,
					interviewOrFolderNames,
				}
			})),
			count: countQuery.length,
		},
	})
}

export const getWebhooks = async (req: AuthenticatedRequest, res: Response) => {
	const page = req.query.page || 0
	const pageSize = req.query.limit || 10
	const [result, total] = await WebhookEntity.findAndCount({
		where: {
			team: {
				id: req.headers.team_id,
			},
		},
		take: pageSize,
		skip: (page * pageSize),
		relations: ['user'],
	})

	return response({
		res,
		data: {
			responses: await Promise.all(result.map(async (webhook) => await webhook.toPublic())),
			count: total,
		},
	})
}
