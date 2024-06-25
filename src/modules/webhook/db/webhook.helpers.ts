/* eslint-disable max-len */
import axios from 'axios'
import { WebhookEntity } from './webhook.entity'
import { WebhookEventType } from './webhook.types'
import logger from '../../../util/logger.util'
import { InterviewEntity } from '../../../modules/interview/db/interview.entity'
import { getInterviewFolderNameById } from '../../../modules/interview-folder/db/interview-folder.helper'
import { getInterviewNameById } from '../../../modules/interview/db/interview.helper'

export const fireWebhook = async (webhook: WebhookEntity, payload: any) => {
	try {
		const response = await axios({
			method: 'POST',
			url: webhook.url,
			data: payload,
		})
		logger.info(`Successfully fired webhook to ${webhook.url}`)
		return response
	} catch (error) {
		logger.error(`Error firing webhook to ${webhook.url}: ${error.message}`)
	}
}
export const getAndFireWebhooks = async (type: WebhookEventType, data: string, payload: any) => {
	const interview = await InterviewEntity.findOne({
		where: {
			id: data,
		},
		relations: ['folder'],
	})

	const webhooksToFire = []
	const uniqueUrls = new Set()

	if (interview && interview.folder) {
		const _type = type === WebhookEventType.NEW_RESPONSE ? WebhookEventType.FOLDER_NEW_RESPONSE : WebhookEventType.FOLDER_PHONE_TRANSFER
		const folderWebhooks = await WebhookEntity.find({
			where: {
				type: _type,
				data: interview.folder_id,
			},
		})
		logger.debug(`Found ${folderWebhooks.length} folder webhooks for ${_type}`)
		folderWebhooks.forEach(webhook => {
			if (!uniqueUrls.has(webhook.url)) {
				uniqueUrls.add(webhook.url)
				webhooksToFire.push(fireWebhook(webhook, payload))
			}
		})
	}

	const directWebhooks = await WebhookEntity.find({
		where: {
			type,
			data,
		},
	})
	logger.debug(`Found ${directWebhooks.length} direct webhooks for ${type}`)
	directWebhooks.forEach(webhook => {
		if (!uniqueUrls.has(webhook.url)) {
			uniqueUrls.add(webhook.url)
			webhooksToFire.push(fireWebhook(webhook, payload))
		}
	})

	// Wait for all webhooks to be processed, handling errors locally within fireWebhook
	return Promise.allSettled(webhooksToFire).then(results => {
		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				logger.error(`Webhook at index ${index} failed: ${result.reason}`)
			}
		})
	})
}

export const getInterviewOrFolderName = async (data) => {
	let result

	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data)) {
		result = getInterviewFolderNameById(data).then(res => res[0].name || null)
	}
	if (data.length === 8) {
		result = getInterviewNameById(data).then(res => res[0]?.title || null)
	}

	return result || null
}
