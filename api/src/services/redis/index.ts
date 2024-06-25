import { captureError } from './../../util/error.util'
import { createClient, SetOptions } from 'redis'
import logger from '../../util/logger.util'

export const redis = createClient({
	url: `redis://${process.env.REDIS_HOST}`,
})

redis.on('error', (error) => captureError(error))
redis.on('connect', () => logger.debug(`Connected to Redis using address: ${process.env.REDIS_HOST}`))
redis.on('disconnect', () => logger.debug('Disconnected from Redis'))

export const connectRedis = () => redis.connect()
export const disconnectRedis = () => redis.disconnect()

export const redisWrite = (key: string, value: string, options?: SetOptions) => redis.set(key, value, options)

export const redisRead = (key: string) => redis.get(key)

export const redisDelete = (key: string) => redis.del(key)
