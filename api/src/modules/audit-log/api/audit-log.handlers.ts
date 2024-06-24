import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import { AuditLogEntity } from '../db/audit-log.entity'
import response from '../../../services/server/response'
import { Brackets } from 'typeorm'

export const getAuditLogs = async (req: AuthenticatedRequest, res: Response) => {
	const teamId = req.headers.team_id
	const userId = req.query.user_id
	const actionType = req.query.action_type
	const sortBy = req.query.sort_by
	const page = req.query.page || 0
	const pageSize = req.query.limit || 10
	const search = req.query.search

	let orderbyDirection: 'DESC'| 'ASC' = 'DESC'

	let query = AuditLogEntity.createQueryBuilder('log')
		.leftJoinAndSelect('log.user', 'user')
		.leftJoinAndSelect('log.team', 'team')
		.where('log.team_id = :team_id', { team_id: teamId })

	if (userId) {
		query = query.andWhere('log.user_id = :user_id', { user_id: userId })
	}

	if (actionType) {
		query = query.andWhere('log.action_type = :action_type', { action_type: actionType })
	}

	if (sortBy === 'timestamp_ASC') {
		orderbyDirection = 'ASC'
	}

	if (sortBy === 'timestamp_DESC') {
		orderbyDirection = 'DESC'
	}

	if (search) {
		query.andWhere(new Brackets(qb => {
			qb.where("CONCAT(user.first_name, ' ', user.last_name) ILIKE :search", { search: `%${search}%` })
				.orWhere('log.action_type ILIKE :search', { search: `%${search}%` })
				.orWhere('log.resource ILIKE :search', { search: `%${search}%` })
		}))
	}

	const [count, responses] = await Promise.all([
		query.getCount(),
		query
			.orderBy('log.timestamp', orderbyDirection)
			.take(pageSize)
			.skip(page * pageSize)
			.getMany(),
	])

	return response({
		res,
		data: {
			responses: responses?.map(r => r),
			count,
		},
	})
}
