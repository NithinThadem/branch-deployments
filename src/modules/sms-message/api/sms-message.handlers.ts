import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { SmsMessageEntity } from '../db/sms-message.entity'

export const getSmsMessagesForPhoneNumber = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10

	const queryBuilder = SmsMessageEntity.createQueryBuilder('sms_message')
		.where('sms_message.phone_number_id = :phone_number_id', { phone_number_id: req.params.phone_number_id })
		.where('sms_message.team_id = :team_id', { team_id: req.headers.team_id })
		.orderBy('sms_message.created', 'DESC')
		.limit(resultsPerPage)

	if (req.query.page) {
		queryBuilder.skip(resultsPerPage * req.query.page)
	}

	const [sms_messages, count] = await queryBuilder.getManyAndCount()

	return response({
		res,
		data: {
			sms_messages,
			count,
		},
	})
}

export const getSmsMessages = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10

	const queryBuilder = SmsMessageEntity.createQueryBuilder('sms_message')
		.where('sms_message.team_id = :team_id', { team_id: req.headers.team_id })
		.orderBy('sms_message.created', 'DESC')
		.limit(resultsPerPage)

	if (req.query.page) {
		queryBuilder.skip(resultsPerPage * req.query.page)
	}

	const [sms_messages, count] = await queryBuilder.getManyAndCount()

	return response({
		res,
		data: {
			sms_messages,
			count,
		},
	})
}
