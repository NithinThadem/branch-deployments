import logger from '../../../util/logger.util'
import { captureError } from '../../../util/error.util'
import { ContactTagEntity } from './contact-tag.entity'

export const getOrCreateContactTags = async (tagNames: string[]): Promise<ContactTagEntity[]> =>
	Promise.all(tagNames.map(async (name: string) => {
		try {
			logger.info(`Getting or creating tag: ${name}`)
			let tag = await ContactTagEntity.findOne({ where: { name } })
			if (!tag) {
				tag = ContactTagEntity.create({ name })
				await ContactTagEntity.save(tag)
			}
			return tag
		} catch (error) {
			captureError(error)
			return null
		}
	}))
