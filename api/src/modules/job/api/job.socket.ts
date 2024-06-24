import { Socket } from 'socket.io'
import { captureError } from '../../../util/error.util'
import { dbSubscriber } from '../../../services/database/db-subscriber'
import logger from '../../../util/logger.util'
import { JobEntity } from '../db/job.entity'

export const onJobSocket = async (socket: Socket) => {
	let job_id: string | null = null

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	const onSubscriberMessage = async (message: any) => {
		try {
			const log = JSON.parse(message)
			socket.emit('data', { log })
		} catch (error) {
			_onError(error)
		}
	}

	socket.on('disconnect', async () => {
		logger.debug(`Disconnecting from job:${job_id}`)
		dbSubscriber.notifications.removeListener(`job:${job_id}`, onSubscriberMessage)
		await dbSubscriber.unlisten(`job:${job_id}`)
	})

	if (typeof socket.handshake.query.job_id !== 'string') {
		throw new Error('Job ID is not a string')
	}

	job_id = socket.handshake.query.job_id

	const job = await JobEntity.findOne({
		where: {
			id: job_id,
		},
	})

	if (!job) {
		throw new Error(`Job ${job_id} not found`)
	}

	socket.emit('data', { job })

	await dbSubscriber.listenTo(`job:${job_id}`)
	dbSubscriber.notifications.on(`job:${job_id}`, onSubscriberMessage)

	logger.debug(`Job socket connected: ${socket.handshake.query.job_id}`)
}
