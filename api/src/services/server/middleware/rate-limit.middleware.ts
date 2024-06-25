import { Request, Response, NextFunction } from 'express'
import { redisRead, redisWrite } from '../../redis'
import logger from '../../../util/logger.util'

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS_PER_WINDOW = process.env.RATE_LIMIT_MAX_PER_WINDOW ?
	parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW) :
	100000

export const rateLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
	const teamId = req.headers?.team_id

	if (!teamId) {
		return next() // TODO
	}

	const key = `rate_limit:${teamId}`
	try {
		let requestCount = await redisRead(key)

		if (!requestCount) {
			// If no record, start counting
			await redisWrite(key, '1', { EX: RATE_LIMIT_WINDOW_MS / 1000 })
			requestCount = '1'
		} else {
			// If record exists, increment count
			requestCount = (parseInt(requestCount) + 1).toString()
			await redisWrite(key, requestCount)
		}

		if (parseInt(requestCount) > MAX_REQUESTS_PER_WINDOW) {
			// If limit exceeded, return rate limit error
			res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString())
			res.setHeader('X-RateLimit-Remaining', '0')
			return res.status(429).send('Rate limit exceeded')
		} else {
			// If within limit, set rate limit headers and proceed
			res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString())
			res.setHeader('X-RateLimit-Remaining', (MAX_REQUESTS_PER_WINDOW - parseInt(requestCount)).toString())
			next()
		}
	} catch (error) {
		logger.error('Error in rate limiter middleware:', error)
		res.status(500).send('Internal Server Error')
	}
}
