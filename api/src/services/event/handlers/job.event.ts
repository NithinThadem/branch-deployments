import { JobEntity } from '../../../modules/job/db/job.entity'
import { JobStatus } from '../../../modules/job/db/job.types'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import { EventMap } from '../event.map'
import { handleJobContact, isJobCanceled } from '../../../modules/job/db/job.helpers'
import { UserEntity } from '../../../modules/user/db/user.entity'
import analytics from '../../segment'
import { ContactEntity } from '../../../modules/contact/db/contact.entity'
import { redisRead, redisWrite } from '../../redis'
import { TriggeredMetadata } from '../../../modules/interview-response/db/interview-response.types'

const onJobStart = async ({ job_id, user, triggered_metadata }: EventMap['JOB_START']) => {
	logger.info(`Start job: ${job_id}`)

	const job = await JobEntity.findOneOrFail({
		where: { id: job_id },
		relations: ['team', 'interview', 'interview.team', 'interview.flow', 'interview.outbound_phone_number'],
	})

	await onContactJobCreated(job, user, triggered_metadata)
}

const onContactJobCreated = async (job: JobEntity, user: UserEntity, triggered_metadata?: TriggeredMetadata) => {
	try {
		if (job.status === JobStatus.IN_PROGRESS) {
			return
		}

		let phoneNumber: string

		if (job.interview.outbound_phone_number) {
			logger.info(`Using leased phone number: ${job.interview.outbound_phone_number.phone_number}`)
			phoneNumber = job.interview.outbound_phone_number.phone_number
		} else {
			phoneNumber = process.env.OUTBOUND_PHONE_NUMBER
		}

		job.status = JobStatus.IN_PROGRESS
		await job.save()

		const calledNumbers = new Set()

		const stream = await JobEntity.createQueryBuilder('job')
			.leftJoinAndSelect('job.contacts', 'contact')
			.where('job.id = :jobId', { jobId: job.id })
			.stream()

		let contactCount = 0
		for await (const data of stream) {
			if (await isJobCanceled(job.id)) {
				job.status = JobStatus.CANCELED
				await job.save()
				logger.info(`Job ${job.id} has been canceled.`)
				stream.destroy()
				break
			}
			if (await redisRead(`${job.id}:${data.contact_id}`)) {
				logger.info(`Skipping already called contact: ${data.contact_id}`)
				continue
			}

			await redisWrite(`${job.id}:${data.contact_id}`, 'true', { EX: 30 * 60 })

			contactCount += 1
			if (contactCount % 5 === 0) {
				const currentJob = await JobEntity.findOne({ where: { id: job.id } })
				if (currentJob.status !== JobStatus.IN_PROGRESS) {
					logger.info(`Job ${job.id} is not in progress (status: ${currentJob.status}), stopping process.`)
					stream.destroy()
					await job.appendLog('Job is not in progress, stopping process.')
					return
				}
			}

			const _phoneNumber = data.contact_phone_number

			if (calledNumbers.has(_phoneNumber)) {
				logger.info(`Skipping duplicate number: ${_phoneNumber}`)
				continue
			}

			try {
				if (await isJobCanceled(job.id)) {
					logger.info(`Job ${job.id} was canceled`)
					stream.destroy()
					await job.appendLog('Job was canceled, ending stream.')
					break
				}

				const contact = {
					id: data.contact_id,
					created: data.contact_created,
					team_id: data.contact_team_id,
					status: data.contact_status,
					name: data.contact_name,
					caller_type: data.contact_caller_type,
					phone_number: data.contact_phone_number,
					email: data.contact_email,
					attributes: data.contact_attributes,
				} as ContactEntity

				const number = await handleJobContact(job, contact, phoneNumber, user, triggered_metadata)
				calledNumbers.add(number)
			} catch (error) {
				const eventId = captureError(error)
				await job.appendLog(`Error calling contact ${data.contact_id} (${eventId})`, 'error')
			}
		}

		if (!await isJobCanceled(job.id)) {
			const callWord = calledNumbers.size === 1 ? 'call' : 'calls'
			await job.appendLog(`All ${calledNumbers.size} ${callWord} queued`)

			job.status = JobStatus.COMPLETE
			await job.save()

			try {
				analytics.track({
					userId: user.id,
					event: 'Job Completed',
					properties: {
						job_id: job.id,
						interview_id: job.interview.id,
						team_id: job.team.id,
						total_numbers: calledNumbers.size,
						type: 'CONTACTS',
					},
				})
			} catch (error) {
				// noop
			}

			job.status = JobStatus.COMPLETE
			await job.save()
			logger.info(`Job ${job.id} marked as COMPLETE.`)
		} else {
			const callWord = calledNumbers.size === 1 ? 'call' : 'calls'
			await job.appendLog(`${calledNumbers.size} ${callWord} queued before cancellation`)
		}
	} catch (error) {
		const eventId = captureError(error)
		await job.appendLog(`Job failed to start (${eventId})`, 'error')
	}
}
export default {
	onJobStart,
}
