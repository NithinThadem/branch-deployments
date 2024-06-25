/* eslint-disable max-len */
import { ContactEntity } from '../../../modules/contact/db/contact.entity'
import logger from '../../../util/logger.util'
import { EventMap } from '../event.map'
import { parsePhoneNumber } from 'awesome-phonenumber'
import { deleteFile, downloadFileStream } from '../../../services/google/storage'
import * as csv from 'csv-parser'
import { sendEventToLoops } from '../../../services/email'
import { ContactTagEntity } from '../../../modules/contact-tag/db/contact-tag.entity'

interface CsvRowObject {
	phone_number?: string;
	name?: string;
	email?: string;
	first_name?: string
	last_name?: string
	tags?: string[]
	attributes?: string[]
}

export const onBulkContactsCreated = async ({
	user_email,
	file_url,
	active_headers,
	team_id,
	country_code,
	addedTags,
	leadSource,
}: EventMap['BULK_CONTACTS_CREATED']) => {
	const contactsStream = await downloadFileStream(file_url)
	const contacts = []

	return new Promise((resolve, reject) => {
		let originalHeaders = []

		contactsStream
			.pipe(csv())
			.on('data', async (data) => {
				if (!originalHeaders.length) {
					originalHeaders = Object.keys(data).map(header => header.trim())
				}

				const rowObject = {} as CsvRowObject
				const tags = []
				const attributes: Record<string, any> = {}

				Object.entries(active_headers).forEach(([originalHeader, newHeader]) => {
					const matchingHeader = originalHeaders.find(header => header.toLowerCase() === originalHeader.toLowerCase())
					if (matchingHeader && data[matchingHeader] !== undefined) {
						if (newHeader === 'tags') {
							const tagValue = data[matchingHeader].trim()
							if (tagValue) {
								tags.push(tagValue)
							}
						} else if (newHeader === 'attributes') {
							const attributeValue = data[matchingHeader].trim()
							if (attributeValue) {
								attributes[matchingHeader] = attributeValue
							}
						} else {
							rowObject[newHeader] = data[matchingHeader]
						}
					}
				})

				if (rowObject.phone_number) {
					if (typeof rowObject.phone_number !== 'string' || !rowObject.phone_number.trim()) {
						logger.warn('Rejecting row due to invalid phone number:', rowObject)
						return
					}
				}

				let rawPhoneNumber = rowObject.phone_number.trim()

				if (!rawPhoneNumber.startsWith('+')) {
					rawPhoneNumber = country_code + rawPhoneNumber
				}

				const phoneNumber = parsePhoneNumber(rawPhoneNumber)

				if (!phoneNumber.valid) {
					logger.warn('Rejecting row due to non-valid phone number:', rowObject)
					return
				}

				const fullName = rowObject.name ? rowObject.name.trim()
					: `${rowObject.first_name?.trim() || ''} ${rowObject.last_name?.trim() || ''}`.trim()
					|| 'Unknown'
				if (!fullName) {
					return
				}

				const phone = phoneNumber ? phoneNumber.number.e164 : null
				const email = rowObject.email ? rowObject.email.trim() : null

				const combinedTags = Array.from(new Set([...tags, ...addedTags]))
				const tagEntities = []
				for (const tagName of combinedTags) {
					let tagEntity = await ContactTagEntity.findOne({ where: { name: tagName } })
					if (!tagEntity) {
						tagEntity = ContactTagEntity.create({ name: tagName })
						await tagEntity.save()
					}
					tagEntities.push(tagEntity)
				}

				try {
					let contact = null

					if (phone) {
						contact = await ContactEntity.findOne({
							where: {
								team_id: team_id,
								phone_number: phone,
							},
						})
					}

					if (!contact && email) {
						contact = await ContactEntity.findOne({
							where: {
								team_id: team_id,
								email: email,
							},
						})
					}

					if (contact) {
						if (tagEntities.length > 0) {
							contact.tags = [...(contact.tags || []), ...tagEntities]
						}
						await contact.save()
					} else {
						contact = await ContactEntity.create({
							team: { id: team_id },
							phone_number: phone,
							name: fullName,
							email: email,
							tags: tagEntities,
							attributes: attributes,
							lead_source: leadSource,
						}).save()
					}
				} catch (error) {
					logger.error(error)
				}
			})
			.on('end', async () => {
				try {
					await deleteFile(file_url)
					logger.info('File deleted successfully from GCS.')
					await sendEventToLoops(user_email, 'Contacts Processed')
					logger.info('Email sent to user notifying them of processing completion.')
				} catch (err) {
					logger.error('Failed to delete file from GCS:', err)
				}

				resolve(contacts)
			})
			.on('error', (error) => {
				logger.error('Error occurred during CSV processing:', error)
				reject(error)
			})
	})
}
