import axios from 'axios'
import { AuthenticatedRequest } from '../../../types'
import { Response } from 'express'
import response from '../../../services/server/response'
import { redisRead, redisWrite } from '../../../services/redis'
import logger from '../../../util/logger.util'

export const getPlatformStatus = async (req: AuthenticatedRequest, res: Response) => {
	const cache = await redisRead('platform-status')

	if (cache) {
		return response({
			res,
			data: JSON.parse(cache),
		})
	}

	logger.debug('Fetching updated platform status from statuspage.io')

	const { data } = await axios({
		method: 'GET',
		url: 'https://0brjgcpshcbz.statuspage.io/api/v2/summary.json',
	})

	await redisWrite('platform-status', JSON.stringify(data), {
		EX: 60 * 3, // 3 minutes
	})

	return response({
		res,
		data,
	})
}
