import response from '../../../services/server/response'
import { AuthenticatedRequest } from '../../../types'
import { ApiTokenEntity } from '../db/api-token.entity'
import { Response } from 'express'

export const getTokens = async (req: AuthenticatedRequest, res: Response) => {
	const tokens = await ApiTokenEntity.find({
		where: {
			team: {
				id: req.headers.team_id,
			},
		},
		relations: ['user'],
	})

	return response({
		res,
		data: tokens,
	})
}

export const createToken = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const existing = await ApiTokenEntity.count({
		where: {
			team: {
				id: req.headers.team_id,
			},
		},
	})

	if (existing >= 10) {
		return response({
			res,
			error: 'You can only have 10 API tokens per team.',
		})
	}

	const hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

	const token = await ApiTokenEntity.create({
		team: req.headers.team_id,
		token: hash,
		user,
	}).save()

	return response({ res, data: token })
}

export const revokeToken = async (req: AuthenticatedRequest, res: Response) => {
	const token = await ApiTokenEntity.findOneOrFail({
		where: {
			id: req.params.token_id,
			team: {
				id: req.headers.team_id,
			},
		},
	})

	await token.remove()

	return response({ res })
}
