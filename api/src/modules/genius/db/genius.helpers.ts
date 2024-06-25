import { GeniusSourceEntity } from '../../genius-source/db/genius-source.entity'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { Index, PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { Pinecone } from '../../../services/pinecone'
import * as pdfParse from 'pdf-parse'
import * as csvParser from 'csv-parser'
import logger from '../../../util/logger.util'
import { captureError } from '../../../util/error.util'
import { ConversationHistory } from '../../interview-response/db/interview-response.types'

export const addTextSourceToPinecone = async (source: GeniusSourceEntity) => {
	const pinecone = Pinecone()
	const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX as string).namespace(`genius-${source.genius_id}`)

	const stats = await pineconeIndex.describeIndexStats()
	logger.debug(`Total records in namespace (${source.genius_id}): ${stats.totalRecordCount}`)

	if (source.type === 'CSV') {
		const jsonObj = JSON.parse(source.content || '[]')
		await Promise.all(jsonObj.map(async (obj: any, index: any) => {
			const objContent = JSON.stringify(obj)
			const vectorValues = await vectorizePrompt(objContent)
			const metadata = { text: objContent }

			const pineconeRecord = {
				id: `${source.id}_${index}`,
				values: vectorValues,
				metadata: metadata,
			}

			await pineconeIndex.upsert([pineconeRecord])
		}))

		source.vectors = jsonObj.length
	} else {
		const trimmedText = source.content.trim()
		const normalizedText = trimmedText.replace(/\s+/g, ' ')

		const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 })
		const docs = await textSplitter.createDocuments([normalizedText])
		const newContentVectorCount = docs.length

		await Promise.all(docs.map(async (doc, index) => {
			const pageContent = doc.pageContent
			const vectorValues = await vectorizePrompt(pageContent)
			const metadata = { text: pageContent }

			const pineconeRecord: PineconeRecord<RecordMetadata> = {
				id: `${source.id}_${index}`,
				values: vectorValues,
				metadata: metadata,
			}

			await pineconeIndex.upsert([pineconeRecord])
		}))

		if (newContentVectorCount < source.vectors) {
			// eslint-disable-next-line max-len
			const idsToDelete = Array.from({ length: source.vectors - newContentVectorCount }, (_, i) => `${source.id}_${i + newContentVectorCount}`)
			if (idsToDelete.length > 0) {
				await pineconeIndex.deleteMany(idsToDelete)
				logger.info(`Deleted extra vectors: ${idsToDelete.join(', ')} from namespace ${source.genius_id}.`)
			}
		}
	}
	await source.save()
}

export const deleteNamespace = async (geniusId: string) => {
	const pinecone = Pinecone()
	const namespaceName = `genius-${geniusId}`
	const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX as string).namespace(namespaceName)

	try {
		await pineconeIndex.deleteAll()
		logger.debug(`Namespace ${namespaceName} and all associated records have been deleted.`)
	} catch (error) {
		captureError(error)
		throw error
	}
}

export async function vectorizePrompt(promptText: string) {
	const embeddingsModel = new OpenAIEmbeddings({
		modelName: 'text-embedding-ada-002',
		openAIApiKey: process.env.OPENAI_API_KEY,
	})

	try {
		const embedding = await embeddingsModel.embedQuery(promptText)
		return embedding
	} catch (error) {
		captureError(error)
		throw error
	}
}

export const deleteSourcesFromNamespace = async (source: GeniusSourceEntity) => {
	const pinecone = Pinecone()
	const namespaceName = `genius-${source.genius_id}`
	const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX as string).namespace(namespaceName)

	try {
		const recordsToDelete = Array.from({ length: source.vectors }, (_, index) => `${source.id}_${index}`)
		if (recordsToDelete.length > 0) {
			await pineconeIndex.deleteMany(recordsToDelete)
		}
		logger.info(`All records for source ${source.id} have been deleted from namespace ${namespaceName}.`)
	} catch (error) {
		captureError(error)
		throw error
	}
}

export interface ParseData {
	text: string;
}

export const parsePdf = (pdfStream: NodeJS.ReadableStream): Promise<ParseData> => new Promise((resolve, reject) => {
	const dataBuffer: Buffer[] = []
	pdfStream.on('data', (chunk: Buffer) => {
		dataBuffer.push(chunk)
	})
	pdfStream.on('end', () => {
		const combinedBuffer = Buffer.concat(dataBuffer)
		pdfParse(combinedBuffer)
			.then((result) => {
				resolve(result)
			})
			.catch(reject)
	})
	pdfStream.on('error', reject)
})

export const parseCsv = (csvStream: NodeJS.ReadableStream): Promise<ParseData> => new Promise((resolve, reject) => {
	const rows = []
	csvStream
		.pipe(csvParser())
		.on('data', (row) => rows.push(row))
		.on('end', () => {
			const text = rows.map(row => Object.values(row).join(', ')).join('\n')
			resolve({ text })
		})
		.on('error', reject)
})

export const queryPinecone = async (message: string, index: Index, topK: number): Promise<string[]> => {
	const promptVector = await vectorizePrompt(message)

	const queryResponse = await index.query({
		vector: promptVector,
		topK,
		includeMetadata: true,
	})

	return queryResponse.matches
		.map(match => match.metadata?.text.valueOf() as string)
		.filter(text => text !== undefined)
}

export const getPineconeIndex = (geniusId: string) =>
	Pinecone().index(process.env.PINECONE_INDEX as string).namespace(`genius-${geniusId}`)

export const getMessagesForPineconeQuery = (conversationHistory: ConversationHistory[]) =>
	conversationHistory
		.filter(({ author }) => author !== 'system')
		.slice(-2)
		.map(i => i.text)
		.join(' ')
