/* eslint-disable max-len */
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { ContactEntity } from '../db/contact.entity'
import { parsePhoneNumber } from 'awesome-phonenumber'
import { Brackets, In } from 'typeorm'
import EventUtil from '../../../services/event'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { InterviewResponseStatus, InterviewResponseType, TriggeredMetadata } from '../../interview-response/db/interview-response.types'
import logger from '../../../util/logger.util'
import { generateInitialConversationHistory, onInterviewStart } from '../../interview-response/api/interview-response.helpers'
import { getOrCreateContactTags } from '../../contact-tag/db/contact-tag.helpers'
import analytics from '../../../services/segment'
import { captureError } from '../../../util/error.util'
import { ContactTagEntity } from '../../contact-tag/db/contact-tag.entity'
import { validate } from 'uuid'
import { JobEntity } from '../../job/db/job.entity'
import { isTeamOverAllowedMinutes } from '../../subscription/db/subscription.helpers'
import { TeamEntity } from '../../team/db/team.entity'
import { LeadSourceTypes } from '../db/contact.types'
import { createCall } from '../../../services/twilio/twilio.helpers'

export const createContact = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const phone_number = req.body.phone_number

	let rawPhoneNumber = phone_number.trim()

	if (!rawPhoneNumber.startsWith('+')) {
		if (req.body.country_code) {
			rawPhoneNumber = req.body.country_code + rawPhoneNumber
		} else {
			rawPhoneNumber = '+1' + rawPhoneNumber
		}
	}

	const phoneNumber = parsePhoneNumber(rawPhoneNumber)

	if (!phoneNumber.valid) {
		return response({ res, status: 400, error: 'Invalid phone number' })
	}

	const exists = await ContactEntity.findOne({
		where: {
			team_id: req.headers.team_id,
			phone_number: phoneNumber.number.e164,
		},
		relations: ['tags'],
	})

	if (exists) {
		logger.debug(`Contact already exists with phone number ${phoneNumber.number.e164}`)

		exists.name = req.body.name
		exists.email = req.body.email
		exists.tags.push(...await getOrCreateContactTags(req.body.tags || []))
		exists.attributes = req.body.attributes || {}
		await exists.save()

		return response({ res, data: exists })
	}

	logger.debug(`Creating new contact with phone number ${phoneNumber.number.e164} on team ${req.headers.team_id}`)

	const data = await ContactEntity.create({
		team: {
			id: req.headers.team_id,
		},
		phone_number: phoneNumber.number.e164,
		name: req.body.name,
		email: req.body.email,
		tags: await getOrCreateContactTags(req.body.tags || []),
		attributes: req.body.attributes || {},
		lead_source: req.auth.tokenUser ? LeadSourceTypes.API_UPLOAD : LeadSourceTypes.DASHBOARD_UPLOAD,
	}).save()

	if (data) {
		try {
			analytics.track({
				userId: user.id,
				event: 'Contact Created',
				properties: {
					distinct_id: user.email,
					contact_id: data.id,
					team_id: req.body.team_id,
					phone_number: req.body.phone_number,
					country_code: req.body.country_code,
					tags: req.body.tags,
					attributes: req.body.attributes,
				},
			})
		} catch (error) {
			captureError(error)
		}
	}

	return response({ res, data })
}

export const updateContactInfo = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const phone_number = req.body.phone_number
	const email = req.body.email
	const name = req.body.name
	const contactId = req.params.id

	const contact = await ContactEntity.findOneOrFail({
		where: {
			id: contactId,
		},
	})

	if (phone_number) {
		let rawPhoneNumber = phone_number.trim()

		if (!rawPhoneNumber.startsWith('+')) {
			if (req.body.country_code) {
				rawPhoneNumber = req.body.country_code + rawPhoneNumber
			} else {
				rawPhoneNumber = '+1' + rawPhoneNumber
			}
		}

		const phoneNumber = parsePhoneNumber(rawPhoneNumber)

		if (!phoneNumber.valid) {
			return response({ res, status: 400, error: 'Invalid phone number' })
		}

		const exists = await ContactEntity.findOne({
			where: {
				team_id: req.headers.team_id,
				phone_number: phoneNumber.number.e164,
			},
		})

		if (exists && phoneNumber.number.e164 !== contact.phone_number) {
			return response({ res, status: 400, error: 'There is already a contact exists with this phone number' })
		}

		contact.phone_number = phoneNumber.number.e164
	}

	if (name) {
		contact.name = name
	}

	if (email) {
		contact.email = email
	}

	await contact.save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Contact Updated',
			properties: {
				distinct_id: user.email,
				contact_id: contactId,
				team_id: req.body.team_id,
				phone_number: req.body.phone_number,
				country_code: req.body.country_code,
				email: req.body.email,
				name: req.body.name,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: contact })
}

export const addTagsToContact = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const contact = await ContactEntity.findOne({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
		relations: ['tags'],
	})

	if (!contact) {
		return response({ res, status: 404, error: 'Contact not found' })
	}

	const tags = await getOrCreateContactTags(req.body.tags)

	contact.tags = [...contact.tags, ...tags]

	await contact.save()

	if (contact) {
		try {
			analytics.track({
				userId: user.id,
				event: 'Tags Added to Contact',
				properties: {
					distinct_id: user.email,
					contact_id: contact.id,
					contact_name: contact.name || 'N/A',
					contact_email: contact.email || 'N/A',
					contact_number: contact.phone_number || 'N/A',
					tags_added: req.body.tags,
					team_id: req.headers.team_id,
				},
			})
		} catch (error) {
			captureError(error)
		}
	}

	return response({ res })
}

export const removeTagsFromContact = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const contact = await ContactEntity.findOne({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
		relations: ['tags'],
	})

	if (!contact) {
		return response({ res, status: 404, error: 'Contact not found' })
	}

	contact.tags = contact.tags.filter((tag) => req.body.tags.indexOf(tag.name) === -1)

	await contact.save()

	if (contact) {
		try {
			analytics.track({
				userId: user.id,
				event: 'Tags Removed from Contact',
				properties: {
					distinct_id: user.email,
					contact_id: contact.id,
					contact_name: contact.name || 'N/A',
					contact_email: contact.email || 'N/A',
					contact_number: contact.phone_number || 'N/A',
					tags_removed: req.body.tags,
					team_id: req.headers.team_id,
				},
			})
		} catch (error) {
			captureError(error)
		}
	}

	return response({ res })
}

export const bulkAddTagsToContacts = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const { ids, selectAllActive } = req.body
	const newTags = await getOrCreateContactTags(req.body.tags)

	let whereCondition: any = { team_id: req.headers.team_id }

	if (!selectAllActive) {
		whereCondition = { ...whereCondition, id: In(ids) }
	}

	const contacts = await ContactEntity.find({
		where: whereCondition,
		relations: ['tags'],
	})

	if (!selectAllActive && contacts.length !== ids.length) {
		return response({ res, status: 404, error: 'One or more contacts not found' })
	}

	for (const contact of contacts) {
		contact.tags = Array.from(new Set([...contact.tags, ...newTags]))
		await contact.save()
		try {
			analytics.track({
				userId: user.id,
				event: 'Tags Added to Contact',
				properties: {
					distinct_id: user.email,
					contact_id: contact.id,
					contact_name: contact.name || 'N/A',
					contact_email: contact.email || 'N/A',
					contact_number: contact.phone_number || 'N/A',
					tags_added: req.body.tags,
					team_id: req.headers.team_id,
				},
			})
		} catch (error) {
			captureError(error)
		}
	}

	return response({ res, status: 200, data: 'Tags added successfully' })
}

export const bulkRemoveTagsFromContacts = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const { ids, selectAllActive } = req.body
	const tagsToRemove = req.body.tags

	let whereCondition: any = { team_id: req.headers.team_id }

	if (!selectAllActive) {
		whereCondition = { ...whereCondition, id: In(ids) }
	}

	const contacts = await ContactEntity.find({
		where: whereCondition,
		relations: ['tags'],
	})

	if (!selectAllActive && contacts.length !== ids.length) {
		return response({ res, status: 404, error: 'One or more contacts not found' })
	}

	for (const contact of contacts) {
		contact.tags = contact.tags.filter(tag => !tagsToRemove.includes(tag.name))
		await contact.save()

		if (contact) {
			try {
				analytics.track({
					userId: user.id,
					event: 'Tags Removed from Contact',
					properties: {
						distinct_id: user.email,
						contact_id: contact.id,
						contact_name: contact.name || 'N/A',
						contact_email: contact.email || 'N/A',
						contact_number: contact.phone_number || 'N/A',
						tags_removed: req.body.tags,
						team_id: req.headers.team_id,
					},
				})
			} catch (error) {
				captureError(error)
			}
		}
	}

	return response({ res, status: 200, data: 'Tags removed successfully' })
}

export const addAttributeToContacts = async (req, res) => {
	const { ids, key, value } = req.body

	const contacts = await ContactEntity.find({
		where: { id: In(ids) },
	})

	contacts.forEach(contact => {
		if (!contact.attributes) {
			contact.attributes = {}
		}
		contact.attributes[key] = value
	})

	await ContactEntity.save(contacts)

	return res.json({ message: 'Attributes added successfully.' })
}

export const removeAttributeFromContacts = async (req, res) => {
	const { ids, key } = req.body

	const contacts = await ContactEntity.find({
		where: { id: In(ids) },
	})

	contacts.forEach(contact => {
		if (contact.attributes && key in contact.attributes) {
			delete contact.attributes[key]
		}
	})

	await ContactEntity.save(contacts)

	return res.json({ message: 'Attributes removed successfully.' })
}

export const getContacts = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10
	const page = req.query.page || 0
	const sort = req.query.sort || 'name_asc'

	const sortRegex = /(.+)_(asc|desc)$/
	const match = sort.match(sortRegex)

	let sortField: string
	let sortOrder: 'ASC' | 'DESC'
	if (match) {
		sortField = match[1]
		sortOrder = match[2].toUpperCase() as 'ASC' | 'DESC'
	} else {
		sortField = 'name'
		sortOrder = 'ASC'
	}
	const queryBuilder = ContactEntity.createQueryBuilder('contact')
		.leftJoinAndSelect('contact.tags', 'tag')
		.where('contact.team_id = :teamId', { teamId: req.headers.team_id })

	if (req.query.search) {
		queryBuilder.andWhere(new Brackets(qb => {
			qb.where('contact.name ILIKE :search', { search: `%${req.query.search}%` })
				.orWhere('contact.phone_number ILIKE :search', { search: `%${req.query.search}%` })
				.orWhere('contact.email ILIKE :search', { search: `%${req.query.search}%` })
		}))
	}

	if (req.query.tags && req.query.tags.length > 0) {
		queryBuilder.andWhere('tag.name IN (:...tags)', { tags: req.query.tags })
	}

	if (req.query.excluded_tags && req.query.excluded_tags.length > 0) {
		const excludeQuery = `NOT EXISTS (SELECT 1 FROM contact_tags ct 
					         JOIN contact_tag tag ON ct.tag_id = tag.id 
							 WHERE ct.contact_id = contact.id AND tag.name IN (:...excludedTags))`
		queryBuilder.andWhere(excludeQuery, { excludedTags: req.query.excluded_tags })
	}

	if (req.query.phone_numbers_only) {
		queryBuilder.andWhere('contact.phone_number IS NOT NULL')
	}

	const totalCount = await queryBuilder.getCount()

	const contacts = await queryBuilder
		.orderBy(`contact.${sortField}`, sortOrder)
		.take(resultsPerPage)
		.skip(resultsPerPage * page)
		.getMany()

	return response({
		res,
		data: {
			contacts,
			count: totalCount,
			total_count: totalCount,
		},
	})
}

export const getAllContactAttributes = async (req: AuthenticatedRequest, res: Response) => {
	const queryBuilder = ContactEntity.createQueryBuilder('contact')
		.select(['contact.id', 'contact.attributes'])
		.where('contact.team_id = :teamId', { teamId: req.headers.team_id })

	const contacts = await queryBuilder.getMany()

	const allKeys = new Set<string>()
	contacts.forEach((contact) => {
		const attributes = contact.attributes || {}
		Object.keys(attributes).forEach((key) => {
			allKeys.add(key)
		})
	})

	const uniqueKeys = Array.from(allKeys)

	return response({
		res,
		data: { attributes: uniqueKeys },
	})
}

export const getAllContactTags = async (req: AuthenticatedRequest, res: Response) => {
	const teamId = req.headers.team_id
	const searchTerm = req.query.search as string || ''

	const queryBuilder = ContactTagEntity.createQueryBuilder('tag')
		.leftJoin('tag.contacts', 'contact')
		.where('contact.team_id = :teamId', { teamId })
		.andWhere('LOWER(tag.name) LIKE LOWER(:searchTerm)', { searchTerm: `%${searchTerm}%` })
		.select('DISTINCT tag.name', 'name')
		.orderBy('tag.name')

	const tags = await queryBuilder.getRawMany()

	const uniqueTags = tags.map(tag => tag.name)

	return response({
		res,
		data: { tags: uniqueTags },
	})
}

export const deleteContact = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const contact = await ContactEntity.findOne({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})

	if (!contact) {
		return response({ res, status: 404, error: 'Contact not found' })
	}
	try {
		analytics.track({
			userId: user.id,
			event: 'Contact Deleted',
			properties: {
				distinct_id: user.email,
				contact_id: contact.id,
				contact_name: contact.name || 'N/A',
				contact_email: contact.email || 'N/A',
				contact_number: contact.phone_number || 'N/A',
				tags_removed: req.body.tags,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	await contact.remove()

	return response({ res })
}

export const deleteBulkContacts = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const idsToDelete = req.body.ids
	const { ids, selectAllActive } = req.body

	let whereCondition: any = { team_id: req.headers.team_id }

	if (!selectAllActive) {
		whereCondition = { ...whereCondition, id: In(ids) }
	}

	const contacts = await ContactEntity.find({ where: whereCondition })

	if (!selectAllActive && contacts.length !== idsToDelete.length) {
		return response({ res, status: 404, error: 'One or more contacts not found' })
	}

	for (const contact of contacts) {
		try {
			analytics.track({
				userId: user.id,
				event: 'Contact Deleted',
				properties: {
					distinct_id: user.email,
					contact_id: contact.id,
					contact_name: contact.name || 'N/A',
					contact_email: contact.email || 'N/A',
					contact_number: contact.phone_number || 'N/A',
					tags_removed: req.body.tags,
					team_id: req.headers.team_id,
				},
			})
		} catch (error) {
			captureError(error)
		}

		await contact.remove()
	}

	return response({ res, status: 200, data: 'Contacts deleted successfully' })
}

export const getContactCount = async (req: AuthenticatedRequest, res: Response) => {
	const tags = req.query.tags || []
	const contacts = req.query.contacts || []
	const searchType = req.query.search_type || 'BROAD'

	const contactQuery = ContactEntity.createQueryBuilder('contact')
		.leftJoinAndSelect('contact.tags', 'tag')
		.leftJoinAndSelect('contact.team', 'team')
		.where('contact.team_id = :teamId', { teamId: req.headers.team_id })

	if (contacts.length > 0) {
		contactQuery.andWhere('contact.id IN (:...contacts)', { contacts })
	}

	if (tags.length > 0) {
		if (searchType === 'BROAD') {
			contactQuery.andWhere('tag.name IN (:...tags)', { tags })
		} else {
			const subQuery = `
				SELECT contactSub.id
				FROM contact contactSub
				LEFT JOIN contact_tags tagSub ON contactSub.id = tagSub.contact_id
				LEFT JOIN contact_tag tag ON tagSub.tag_id = tag.id
				WHERE tag.name IN (:...tags)
				GROUP BY contactSub.id
				HAVING COUNT(DISTINCT tag.id) = :tagCount
			`
			contactQuery.andWhere(`contact.id IN (${subQuery})`, { tags, tagCount: tags.length })
		}
	}

	if (req.query.excluded_tags && req.query.excluded_tags.length > 0) {
		const excludeQuery = `NOT EXISTS (SELECT 1 FROM contact_tags ct 
					         JOIN contact_tag tag ON ct.tag_id = tag.id 
							 WHERE ct.contact_id = contact.id AND tag.name IN (:...excludedTags))`
		contactQuery.andWhere(excludeQuery, { excludedTags: req.query.excluded_tags })
	}

	const data = await contactQuery.getCount()

	return response({ res, data })
}

export const createBulkContacts = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const files = req.files
	const addedTags = req.body.tags

	try {
		const eventPromises = files.map(async (uploadedFile: { url: string }) => {
			await EventUtil.asyncEmit('BULK_CONTACTS_CREATED', {
				user_email: req.auth.email,
				file_url: uploadedFile.url,
				active_headers: req.body.activeHeaders,
				team_id: req.headers.team_id,
				addedTags,
				country_code: req.body.country_code,
				leadSource: req.auth.tokenUser ? LeadSourceTypes.API_BULK_UPLOAD : LeadSourceTypes.DASHBOARD_BULK_UPLOAD,
			})
		})

		await Promise.all(eventPromises)
	} catch (error) {
		captureError(error)
		return response({ res, error: 'Something went wrong while uploading, please try again.' })
	}

	try {
		analytics.track({
			userId: user.id,
			event: 'Bulk Contacts Completed',
			properties: {
				distinct_id: user.email,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: 'Upload in progress. You will be notified once completed.' })
}

export const callContact = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	/* Check if contact_id is valid uuid or not null  */
	if (!req.body.contact_id || !validate(req.body.contact_id)) {
		return response({ res, status: 400, error: 'Contact not found, please try again' })
	}

	const contact = await ContactEntity.findOne({
		where: {
			id: req.body.contact_id,
			team_id: req.headers.team_id,
		},
	})

	if (!contact) {
		return response({ res, status: 400, error: 'Contact not found, please try again' })
	}

	const interview = await InterviewEntity.findOne({
		where: {
			id: req.body.interview_id,
			team_id: req.headers.team_id,
		},
		relations: ['outbound_phone_number', 'team', 'flow'],
	})

	if (!interview) {
		return response({ res, status: 400, error: 'Thoughtly not found, please try again' })
	}

	if (!contact.phone_number) {
		return response({ res, status: 400, error: 'Contact does not have a phone number' })
	}

	if (interview.outbound_phone_number) {
		logger.info(`Calling from leased phone number ${interview.outbound_phone_number.phone_number}`)
	}

	const data = await onInterviewStart({
		interview,
		team: interview.team,
		type: InterviewResponseType.PHONE_CALL,
		contact,
		metadata: req.body.metadata,
		format: 'ulaw_8000',
		triggered_metadata: req.triggered_metadata,
		direction: 'outbound',
	})

	try {
		data.twilio_sid = await createCall({
			interview_id: interview.id,
			toNumber: contact.phone_number,
		})
	} catch (error) {
		data.status = InterviewResponseStatus.FAILED
		data.call_failure_reason = error.message
		await data.save()
		return response({ res, status: 400, error: error.message || 'Failed to call contact' })
	}

	await data.save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Call Single Contact',
			properties: {
				distinct_id: user.email,
				$ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
				contact_id: contact.id,
				contact_phone_number: contact.phone_number,
				interview_id: interview.id,
				team_id: interview.team.id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data })
}

// System functions

/**
 * System function to handle calling a contact
 *
 * @param contact Contact to call
 * @param fromPhoneNumber phone number to call from
 * @param interview Interview to call for
 * @param job optional job to call for
 * @param triggered_metadata optional triggered metadata
 */
export const systemCallContact = async (
	contact: ContactEntity,
	fromPhoneNumber: string,
	interview: InterviewEntity,
	job?: JobEntity,
	triggered_metadata?: TriggeredMetadata
) => {
	const team = job?.team ?? interview.team
	const interviewUnwrapped = job?.interview ?? interview

	const initialConversationHistory = await generateInitialConversationHistory({
		interview: interviewUnwrapped,
		format: 'ulaw_8000',
		contact,
		generateVoicemail: true,
	})

	if (await isTeamOverAllowedMinutes(team)) {
		await EventUtil.asyncEmit('TEAM_OVER_ALLOWED_MINUTES', { team_id: team.id })
		await job?.appendLog('Team has exceeded allowed minutes')
		return
	}

	try {
		const interviewResponse = await onInterviewStart({
			conversationHistory: initialConversationHistory,
			interview: interviewUnwrapped,
			team: team,
			type: InterviewResponseType.PHONE_CALL,
			format: 'ulaw_8000',
			contact,
			job,
			triggered_metadata,
			direction: 'outbound',
		})

		let sid
		try {
			sid = await createCall({
				interview_id: interviewUnwrapped.id,
				toNumber: contact.phone_number,
			})
		} catch (error) {
			await job?.appendLog(error.message || 'Failed to call contact', 'error')
			interviewResponse.status = InterviewResponseStatus.FAILED
			interviewResponse.call_failure_reason = error.message
			await interviewResponse.save()
			logger.error('Failed to call contact', error)
			return
		}

		interviewResponse.twilio_sid = sid
		await interviewResponse.save()

		try {
			analytics.track({
				userId: 'system',
				event: 'Call Queued',
				properties: {
					job_id: job?.id,
					interview_id: interviewUnwrapped.id,
					team_id: team.id,
					call_sid: sid,
					phone_number_called: fromPhoneNumber,
					type: 'CONTACTS',
				},
			})
		} catch (error) {
			logger.error('Failed to track call queued event', error)
		}
	} catch (error) {
		logger.error('Failed to call contact', error)
	}
}

/**
 * Creates a new contact in Thoughtly from thirdParty contact data
 *
 * @param thirdPartyContact Contact data from thirdParty to create in Thoughtly
 * @param team TeamEntity object to associate the contact with
 * @returns { ContactEntity } Created contact object
 */
export const systemCreateContact = async (thirdPartyContact: { id?: string, phone: string, firstName: string, lastName: string, email: string, leadSource: LeadSourceTypes }, team: TeamEntity): Promise<ContactEntity> => {
	let rawPhoneNumber = thirdPartyContact.phone
	if (!rawPhoneNumber) {
		logger.error('No phone number for third-party contact')
		return null
	}

	if (!thirdPartyContact.phone.startsWith('+')) {
		rawPhoneNumber = `+1${rawPhoneNumber}`
	}

	const phoneNumber = parsePhoneNumber(rawPhoneNumber)
	const fullName = `${thirdPartyContact.firstName} ${thirdPartyContact.lastName}`
	const email = thirdPartyContact.email

	if (!phoneNumber.valid) {
		return null
	}

	const exists = await ContactEntity.findOne({
		where: {
			team_id: team.id,
			phone_number: phoneNumber.number.e164,
		},
		relations: ['tags'],
	})

	if (exists) {
		logger.debug(`Contact already exists with phone number ${phoneNumber.number.e164}`)

		exists.name = fullName
		exists.email = email
		await exists.save()

		return exists
	}

	logger.debug(`Creating new contact with phone number ${phoneNumber.number.e164} on team ${team.id}`)

	const data = await ContactEntity.create({
		team,
		phone_number: phoneNumber.number.e164,
		name: fullName,
		email: email,
		tags: await getOrCreateContactTags([]),
		attributes: {},
		lead_source: thirdPartyContact.leadSource,
	}).save()

	if (data) {
		try {
			analytics.track({
				userId: 'system',
				event: 'Contact Created',
				properties: {
					distinct_id: thirdPartyContact.id,
					contact_id: data.id,
					team_id: team.id,
					phone_number: rawPhoneNumber,
					country_code: null,
					tags: [],
					attributes: {},
				},
			})
		} catch (error) {
			logger.warn('Fail to track contact created event', error)
		}
	}

	return data
}
