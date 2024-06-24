import { UserEntity } from '../../user/db/user.entity'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import { ContactEntity } from '../../contact/db/contact.entity'
import { JobEntity } from './job.entity'
import { JobStatus, PhoneBlock } from './job.types'
import { TriggeredMetadata } from '../../interview-response/db/interview-response.types'
import { systemCallContact } from '../../contact/api/contact.handlers'

export const getTotalNumbersFromBlocks = (blocks: PhoneBlock[]) => {
	const npaCounts: Record<number, number> = {}
	const specificPrefixes: Record<number, Set<number>> = {}
	let totalNumbers = 0

	for (const code of blocks) {
		if (code.nxx !== undefined) {
			// If nxx is provided, check if we've already counted this npa
			if (!npaCounts[code.npa]) {
				// If not, add the specific prefix numbers
				totalNumbers += 10000

				// Keep track of specific prefixes for this npa
				if (!specificPrefixes[code.npa]) {
					specificPrefixes[code.npa] = new Set()
				}
				specificPrefixes[code.npa].add(code.nxx)
			}
		} else {
			// If nxx is not provided, check if we've already counted this npa
			if (!npaCounts[code.npa]) {
				// If not, add 7,920,000 numbers for the area code
				totalNumbers += 7920000
				npaCounts[code.npa] = 7920000

				// Subtract any specific prefixes that have already been counted
				if (specificPrefixes[code.npa]) {
					totalNumbers -= specificPrefixes[code.npa].size * 10000
				}
			}
		}
	}

	return totalNumbers
}

export const isJobCanceled = async (jobId) => {
	const job = await JobEntity.findOne({
		where: {
			id: jobId,
		},
	})
	return job?.status === JobStatus.CANCELED
}

export const handleJobContact = async (
	job: JobEntity,
	contact: ContactEntity,
	phoneNumber: string,
	user: UserEntity,
	triggered_metadata?: TriggeredMetadata
) => {
	if (await isJobCanceled(job.id)) {
		logger.info(`Job ${job.id} has been canceled. Stopping processing.`)
		return
	}

	try {
		await systemCallContact(contact, phoneNumber, job.interview, job, triggered_metadata)

		await job.appendLog(`[${contact.phone_number}]: call queued from ${phoneNumber}`)
	} catch (error) {
		const eventId = captureError(error)
		await job.appendLog(`[${contact.phone_number}]: call failed to queue (${eventId})`, 'warn')
	}

	return contact.phone_number
}
