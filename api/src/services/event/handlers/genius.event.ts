import { GeniusSourceEntity } from '../../../modules/genius-source/db/genius-source.entity'
import { GeniusSourceStatus } from '../../../modules/genius-source/db/genius-source.types'
import { GeniusEntity } from '../../../modules/genius/db/genius.entity'
import {
	addTextSourceToPinecone, deleteNamespace, deleteSourcesFromNamespace, parsePdf,
} from '../../../modules/genius/db/genius.helpers'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import { getDeepgram } from '../../deepgram'
import { deleteFile, downloadFileStream, getFileMetadata } from '../../google/storage'
import { EventMap } from '../event.map'
import puppeteer from 'puppeteer'
import * as csvtojson from 'csvtojson'

const onGeniusUploadAudio = async ({ genius_source_id }) => {
	const source = await GeniusSourceEntity.findOneOrFail({
		where: { id: genius_source_id },
	})

	try {
		logger.info(`[Event] Uploading audio source to Pinecone: ${source.id}`)

		const { results } = await getDeepgram().transcription.preRecorded({
			url: source.file_url,
		}, {
			diarize: true,
			filler_words: true,
			paragraphs: true,
			model: 'nova-2',
			punctuate: true,
		})

		const words = results.channels[0].alternatives[0].words
		let currentSpeaker = words[0]?.speaker
		const transcriptSegments: string[] = []
		let segmentWords: string[] = []

		words.forEach(word => {
			if (word.speaker !== currentSpeaker) {
				transcriptSegments.push(`[${currentSpeaker}]: ${segmentWords.join(' ')}`)
				currentSpeaker = word.speaker
				segmentWords = []
			}
			segmentWords.push(word.word)
		})

		if (segmentWords.length > 0) {
			transcriptSegments.push(`[${currentSpeaker}]: ${segmentWords.join(' ')}`)
		}

		source.content = transcriptSegments.join('\n')

		await source.save()
		await addTextSourceToPinecone(source)

		source.status = GeniusSourceStatus.ACTIVE
		await source.save()
	} catch (error) {
		captureError(error)
		source.status = GeniusSourceStatus.ERROR
		await source.save()
	}
}

const onGeniusUploadText = async ({
	genius_source_id,
}: EventMap['GENIUS_UPLOAD_TEXT']) => {
	const source = await GeniusSourceEntity.findOneOrFail({
		where: {
			id: genius_source_id,
		},
	})

	logger.info(`[Event] Uploading text source to Pinecone: ${source.id}`)

	return await addTextSourceToPinecone(source)
		.then(async () => {
			source.status = GeniusSourceStatus.ACTIVE
			await source.save()
		})
		.catch(async (error) => {
			captureError(error)
			source.status = GeniusSourceStatus.ERROR
			await source.save()
		})
}

const onGeniusUploadFile = async ({
	genius_source_id,
}: EventMap['GENIUS_UPLOAD_FILE']) => {
	const source = await GeniusSourceEntity.findOneOrFail({
		where: {
			id: genius_source_id,
		},
	})

	try {
		logger.info(`[Event] Uploading file source to Pinecone: ${source.id}`)

		const metadata = await getFileMetadata(source.file_url)
		const fileType = metadata.contentType
		switch (fileType) {
			case 'application/pdf': {
				const pdfStream = await downloadFileStream(source.file_url)
				const pdfData = await parsePdf(pdfStream)
				source.content = Buffer.from(pdfData.text, 'utf-8').toString()
				await source.save()
				break
			}
			case 'text/csv': {
				const csvStream = await downloadFileStream(source.file_url)
				const jsonObj = await csvtojson().fromStream(csvStream)
				source.content = JSON.stringify(jsonObj)
				await source.save()
				break
			}
			default:
				throw new Error(`Unsupported file type: ${fileType}`)
		}

		logger.debug(`[Event] File source parsed: ${source.id}`)

		await addTextSourceToPinecone(source)

		source.status = GeniusSourceStatus.ACTIVE
		await source.save()
	} catch (error) {
		captureError(error)
		source.content = error.message
		source.status = GeniusSourceStatus.ERROR
		await source.save()
	}
}

const onGeniusUploadUrl = async ({
	genius_source_id,
}: EventMap['GENIUS_UPLOAD_URL']) => {
	const source = await GeniusSourceEntity.findOneOrFail({
		where: {
			id: genius_source_id,
		},
	})

	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
		headless: true,
	})

	const page = await browser.newPage()

	await page.goto(source.url, { waitUntil: 'networkidle0' })

	const textContent = await page.evaluate(() => document.body.innerText)

	source.content = textContent
	await source.save()

	await addTextSourceToPinecone(source)

	source.status = GeniusSourceStatus.ACTIVE
	await source.save()

	await browser.close()

	logger.info(`[Event] Uploaded URL source to Pinecone: ${source.id}`)
}

export const onGeniusDeleteDatabase = async ({
	genius_id,
}: EventMap['GENIUS_DELETE_DATABASE']) => {
	try {
		const genius = await GeniusEntity.findOneOrFail({
			where: { id: genius_id },
		})

		const sources = await GeniusSourceEntity.find({
			where: { genius_id: genius.id },
		})

		logger.info(`Deleting database and sources for Genius ID ${genius_id}.`)

		await Promise.all(sources.map(async (source) => {
			logger.debug(`Deleting source ${source.id} for Genius ID ${genius_id}.`)
			if (source.file_url) {
				await deleteFile(source.file_url)
			}
			await deleteSourcesFromNamespace(source)
			await source.remove()
		}))

		await deleteNamespace(genius.id)
		await genius.remove()

		logger.info(`Deletion of database and sources for Genius ID ${genius_id} completed.`)
	} catch (error) {
		captureError(error)
		logger.error(`Error deleting database and sources for Genius ID ${genius_id}: ${error}`)
	}
}

export default {
	onGeniusUploadAudio,
	onGeniusUploadText,
	onGeniusUploadFile,
	onGeniusUploadUrl,
	onGeniusDeleteDatabase,
}
