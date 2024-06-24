/* eslint-disable max-len */
import { AuthenticatedRequest } from '../../../types'
import { Response } from 'express'
import { ContactEntity } from '../../contact/db/contact.entity'
import { JobEntity } from '../db/job.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'
import response from '../../../services/server/response'
import logger from '../../../util/logger.util'
import { TeamEntity } from '../../team/db/team.entity'
import EventUtil from '../../../services/event'
import { JobStatus, JobType } from '../db/job.types'
import analytics from '../../../services/segment'
import { captureError } from '../../../util/error.util'
import { normalizePhoneNumbers } from '../../../util/helpers.util'
import { getTeamsOfUser } from '../../../modules/user/db/user.helpers'

export const createJob = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	let totalNumbers = 0
	const interview = await InterviewEntity.findOne({
		where: {
			id: req.body.interview_id,
			team_id: req.headers.team_id,
		},
	})

	const contactQuery = ContactEntity
		.createQueryBuilder('contact')
		.leftJoinAndSelect('contact.tags', 'tag')
		.leftJoinAndSelect('contact.team', 'team')
		.where('team.id = :teamId', { teamId: req.headers.team_id })

	if (req.body.tags && req.body.tags.length > 0) {
		contactQuery.andWhere('tag.name IN (:...tags)', { tags: req.body.tags })
	}

	if (req.body.excluded_tags && req.body.excluded_tags.length > 0) {
		const excludeQuery = `NOT EXISTS (SELECT 1 FROM contact_tags ct 
					         JOIN contact_tag tag ON ct.tag_id = tag.id 
							 WHERE ct.contact_id = contact.id AND tag.name IN (:...excludedTags))`
		contactQuery.andWhere(excludeQuery, { excludedTags: req.body.excluded_tags })
	}

	const contacts = await contactQuery.getMany()

	if (contacts.length === 0) {
		throw new Error('No contacts found for job')
	}

	const job = await JobEntity.create({
		team_id: req.headers.team_id,
		interview,
		type: JobType.GENERAL,
		contacts,
	}).save()

	totalNumbers = contacts.length

	analytics.track({
		userId: user.id,
		event: 'Job Created',
		properties: {
			job_id: job.id,
			interview_id: job.interview.id,
			team_id: job.team_id,
			total_numbers: totalNumbers,
			type: 'GENERAL',
		},
	})

	logger.debug(`Creating job ${job.id} with ${totalNumbers} numbers`)

	await EventUtil.asyncEmit('JOB_START', {
		user,
		job_id: job.id,
		triggered_metadata: req.triggered_metadata,
	})

	return response({ res, data: job })
}

export const createJobByContacts = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const teamId = req.headers.team_id
	const interviewId = req.body.interview_id
	const countryCode = req.body.country_code || '1'
	const normalizedPhoneNumbers = normalizePhoneNumbers(countryCode, req.body.phone_numbers)

	const interview = await InterviewEntity.findOne({
		where: { id: interviewId, team_id: teamId },
	})
	if (!interview) {
		throw new Error('Interview not found')
	}

	let contacts = []

	if (req.body.contact_ids || req.body.phone_numbers) {
		let contactIdsQuery = ContactEntity.createQueryBuilder('contact')
			.andWhere('contact.team_id = :teamId', { teamId })

		const conditions = []

		if (req.body.contact_ids && req.body.contact_ids.length > 0) {
			conditions.push('contact.id IN (:...contactIds)')
		}

		if (req.body.phone_numbers && req.body.phone_numbers.length > 0) {
			if (normalizedPhoneNumbers.length > 0) {
				conditions.push('contact.phone_number IN (:...phoneNumbers)')
			}
		}

		if (conditions.length > 0) {
			contactIdsQuery = contactIdsQuery.andWhere(`(${conditions.join(' OR ')})`, {
				contactIds: req.body.contact_ids,
				phoneNumbers: normalizedPhoneNumbers,
			})
		}

		contacts = await contactIdsQuery.getMany()
	}

	if (!contacts.length) {
		return response({ res, status: 404, error: 'No contacts found for provided identifiers' })
	}

	const job = await JobEntity.create({
		team_id: teamId,
		interview,
		type: JobType.GENERAL,
		contacts,
	}).save()

	const totalNumbers = contacts.length

	analytics.track({
		userId: user.id,
		event: 'Job Created',
		properties: {
			job_id: job.id,
			interview_id: job.interview.id,
			team_id: job.team_id,
			total_numbers: totalNumbers,
			type: 'GENERAL',
		},
	})

	logger.debug(`Creating job ${job.id} with ${totalNumbers} numbers`)

	await EventUtil.asyncEmit('JOB_START', {
		user,
		job_id: job.id,
		triggered_metadata: req.triggered_metadata,
	})

	return response({ res, data: job })
}

export const createResponsesJob = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const teams = await getTeamsOfUser(user.id)
	const team = teams.find(team => team.id === req.headers.team_id) as TeamEntity
	const { select_all, status_filter, tag_filter, job_id, interview_id, type } = req.body
	const jobType = JobType[type] || JobType.GENERAL
	let totalNumbers = 0

	const interview = await InterviewEntity.findOne({
		where: {
			id: interview_id,
			team_id: team.id,
		},
	})

	if (!interview) {
		throw new Error('Interview not found')
	}

	let contactsQuery

	if (select_all) {
		contactsQuery = ContactEntity.createQueryBuilder('contact')
			.leftJoin('contact.interview_responses', 'response')
			.where('contact.team_id = :teamId', { teamId: team.id })

		if (job_id) {
			contactsQuery = contactsQuery
				.leftJoin('response.job', 'job')
				.andWhere('job.id = :jobId', { jobId: job_id })
		}

		if (status_filter && status_filter.length) {
			contactsQuery = contactsQuery.andWhere('response.status IN (:...statusFilter)', { statusFilter: status_filter })
		}
		if (tag_filter && tag_filter.length) {
			contactsQuery = contactsQuery.andWhere('contact.tags @> :tagFilter', { tagFilter: JSON.stringify(tag_filter) })
		}
	} else {
		const contactIds = req.body.contact_ids || []
		if (contactIds.length === 0) {
			throw new Error('No contact IDs provided')
		}
		contactsQuery = ContactEntity.createQueryBuilder('contact')
			.where('contact.id IN (:...contactIds)', { contactIds })
			.andWhere('contact.team_id = :teamId', { teamId: team.id })
	}

	const contacts = await contactsQuery.getMany()

	if (contacts.length === 0) {
		throw new Error('No matching contacts found')
	}

	const job = await JobEntity.create({
		team_id: team.id,
		interview,
		type: jobType,
		contacts,
	}).save()

	totalNumbers = contacts.length

	analytics.track({
		userId: user.id,
		event: 'Responses Job Created',
		properties: {
			job_id: job.id,
			interview_id: job.interview.id,
			team_id: job.team_id,
			total_numbers: totalNumbers,
			type,
		},
	})

	logger.debug(`Creating job ${job.id} with ${totalNumbers} contacts targeted`)

	await EventUtil.asyncEmit('JOB_START', {
		user,
		job_id: job.id,
		triggered_metadata: req.triggered_metadata,
	})

	return response({ res, data: job })
}

export const getJobs = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10

	const queryBuilder = JobEntity.createQueryBuilder('job')
		.leftJoinAndSelect('job.interview', 'interview')
		.where('job.team_id = :teamId', { teamId: req.headers.team_id })
		.orderBy('job.created', 'DESC')
		.take(resultsPerPage)

	if (req.query.interview_id) {
		queryBuilder.andWhere([
			{ interview_id: req.query.interview_id },
		])
	}

	if (req.query.page) {
		queryBuilder.skip(resultsPerPage * req.query.page)
	}

	const [jobs, count] = await queryBuilder.getManyAndCount()

	return response({
		res,
		data: {
			jobs,
			count,
		},
	})
}

export const getJob = async (req: AuthenticatedRequest, res: Response) => {
	const job = await JobEntity.findOne({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})

	return response({ res, data: job })
}

export const killJob = async (req: AuthenticatedRequest, res: Response) => {
	const jobId = req.params.id
	const user = await req.auth.getUser()

	try {
		const job = await JobEntity.findOne({
			where: {
				id: req.params.id,
				team_id: req.headers.team_id,
			},
		})
		if (!job) {
			return response({ res, status: 404, error: 'Job not found' })
		}

		job.status = JobStatus.CANCELED
		await job.save()

		try {
			analytics.track({
				userId: user.id,
				event: 'Job Canceled',
				properties: {
					job_id: job.id,
					team_id: job.team_id,
					type: job.type,
				},
			})
		} catch (error) {
			captureError(error)
		}

		logger.info(`Job ${jobId} has been canceled`)
		return response({ res, data: { message: 'Job successfully canceled' } })
	} catch (error) {
		logger.error(`Error canceling job ${jobId}: ${error.message}`)
		return response({ res, status: 500, error: 'Internal server error' })
	}
}
