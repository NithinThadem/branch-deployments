/* eslint-disable max-len */
import { google } from '@google-cloud/speech/build/protos/protos'
import { downloadFile, downloadFileStream, uploadFileByPath } from '../../../services/google/storage'
import { getCacheDirectory, levenshteinDistance, withExponentialBackoff } from '../../../util/helpers.util'
import { join } from 'path'
import * as fs from 'fs'
import logger from '../../../util/logger.util'
import { captureError } from '../../../util/error.util'
import { generateThumbnail, mergeAndConvertToMP4 } from '../../../services/ffmpeg'
import { ConversationHistory } from '../../interview-response/db/interview-response.types'
import ElevenLabs from '../../../services/elevenlabs'
import { InterviewEdge, InterviewNode } from '../../interview-flow/db/interview-flow.types'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { layoutNodesAndEdges } from '../../interview-flow/db/interview-flow.helpers'
import { MetricMethod, MetricType, StatusMetric } from '../db/interview.types'

export const synthesizeSpeech = async (text: string, aiName: string, outputFormat?: string) => {
	const { platform, id } = voiceIdFromName(aiName)

	switch (platform) {
		// case 'GCP': {
		// 	const [{ audioContent }] = await textToSpeech.synthesizeSpeech({
		// 		input: { text },
		// 		voice: {
		// 			languageCode: 'en-US',
		// 			name: id,
		// 		},
		// 		audioConfig: {
		// 			audioEncoding: 'MP3',
		// 		},
		// 	})
		// 	return Buffer.from(audioContent as string, 'base64')
		// }
		case 'ELEVEN_LABS': {
			const audio = await ElevenLabs.synthesizeSpeech({
				id,
				text,
				outputFormat,
			})
			return Buffer.from(audio, 'binary')
		}
	}
}

export const voiceIdFromName = (name: string): {
	platform: 'ELEVEN_LABS'
	id: string
} => {
	switch (name.toLowerCase()) {
		case 'gabriel': return { platform: 'ELEVEN_LABS', id: 'LlsiGQPTj7Tt7gsEPZl0' }
		case 'gabriel_en': return { platform: 'ELEVEN_LABS', id: 'LlsiGQPTj7Tt7gsEPZl0' }
		case 'gabriel_es': return { platform: 'ELEVEN_LABS', id: 'LlsiGQPTj7Tt7gsEPZl0' }

		case 'tessa': return { platform: 'ELEVEN_LABS', id: 'jJBJgyD7Nnky4AowziII' }
		case 'james': return { platform: 'ELEVEN_LABS', id: 'flq6f7yk4E4fJM5XTYuZ' }
		case 'phillip': return { platform: 'ELEVEN_LABS', id: 'onwK4e9ZLuTAKqWW03F9' }
		case 'lisa': return { platform: 'ELEVEN_LABS', id: 'XrExE9yKIg1WjnnlVkGX' }
		case 'christine': return { platform: 'ELEVEN_LABS', id: 'ThT5KcBeYPX3keUQqHPh' }
		case 'hannah': return { platform: 'ELEVEN_LABS', id: 'yoF80pzNNhrUiwCxkCpa' }
		case 'michael': return { platform: 'ELEVEN_LABS', id: 'd26zuXKUVhSaow6vmHsv' }
		case 'maya': return { platform: 'ELEVEN_LABS', id: 'Ae2G6cGvbCITFpORqZZd' }
		case 'pierre': return { platform: 'ELEVEN_LABS', id: 'E4GQ42zEV1kwul03Bl16' }
		case 'ashleigh': return { platform: 'ELEVEN_LABS', id: '7JnojipaQYgk415wV4yS' }

		case 'louis_en': return { platform: 'ELEVEN_LABS', id: 'TQaDhGYcKI0vrQueAmVO' }
		case 'louis_fr': return { platform: 'ELEVEN_LABS', id: 'TQaDhGYcKI0vrQueAmVO' }
		case 'louis': return { platform: 'ELEVEN_LABS', id: 'TQaDhGYcKI0vrQueAmVO' }
		case 'reouven': return { platform: 'ELEVEN_LABS', id: '9lpBGRvRIk7eRMMBO0us' }

		case 'carolina': return { platform: 'ELEVEN_LABS', id: 'UOIqAnmS11Reiei1Ytkc' }
		case 'sanjay': return { platform: 'ELEVEN_LABS', id: 'grqnOsPb5yaBXkJhXU55' }
		case 'bruce': return { platform: 'ELEVEN_LABS', id: 'fTnb7l9vrG0TvdIW06qr' }
		case 'sophie': return { platform: 'ELEVEN_LABS', id: 'XKSdmBp4RW5sPLpAvPGC' }
		case 'michelle': return { platform: 'ELEVEN_LABS', id: 'ZUp4s27LNerQcEs8YDGI' }
		case 'jacob': return { platform: 'ELEVEN_LABS', id: 'HDA9tsk27wYi3uq0fPcK' }
		default: return { platform: 'ELEVEN_LABS', id: 'EXAVITQu4vr4xnSDxMaL' }
	}
}

export const voiceModelFromLanguage = (lang: string): string => {
	switch (lang.toLowerCase()) {
		case 'en': return 'eleven_turbo_v2'
		default: return 'eleven_multilingual_v2'
	}
}

export const extractTimingsFromTranscriptUsingLevenDistance = (
	phrase: string,
	transcript: google.cloud.speech.v1.ISpeechRecognitionResult[]
) => {
	let bestMatch: google.cloud.speech.v1.IWordInfo[] | null = null
	let bestMatchDistance = Number.MAX_SAFE_INTEGER

	for (const obj of transcript) {
		const words = obj.alternatives[0].words
		const fullTranscript = words.map((word) => word.word).join(' ')

		const distance = levenshteinDistance(phrase, fullTranscript)
		if (distance < bestMatchDistance) {
			bestMatchDistance = distance
			bestMatch = words
		}
	}

	if (bestMatch) {
		let startTime = 0
		let endTime = 0

		if (!isNaN(bestMatch[0].startTime.seconds as any) && !isNaN(bestMatch[0].startTime.nanos)) {
			startTime = Number(bestMatch[0].startTime.seconds) * 1000000000 + Number(bestMatch[0].startTime.nanos)
		}

		if (
			!isNaN(bestMatch[bestMatch.length - 1].endTime.seconds as any) &&
			!isNaN(bestMatch[bestMatch.length - 1].endTime.nanos)
		) {
			endTime = Number(bestMatch[bestMatch.length - 1].endTime.seconds) *
				1000000000 + Number(bestMatch[bestMatch.length - 1].endTime.nanos)
		}

		return { startTime, endTime }
	}

	return {}
}

export const extractTimingsFromTranscript = (
	quote: string,
	transcript: google.cloud.speech.v1.ISpeechRecognitionResult[]
): { startTime: number, endTime: number, endBufferSeconds: number } => {
	const normalizeString = (string: string) => string.toLowerCase().replace('.', '')

	const words = quote.split(' ').map(normalizeString)
	const possibleMatches: { startTime: number, endTime: number, phrase: string, endBufferSeconds: number }[] = []
	const getSeconds = (seconds: string | number | Long, nanos: number) =>
		(Number(seconds || 0) + (nanos / 1e9))
	const calculateEndBuffer = (
		startTime: number,
		transcript: google.cloud.speech.v1.ISpeechRecognitionResult[],
		currentSegmentIndex: number,
		currentWordIndex: number
	): number => {
		const nextWordIndex = currentWordIndex + 1
		if (nextWordIndex < transcript[currentSegmentIndex].alternatives[0].words.length) {
			const nextWordStartTime = getSeconds(
				transcript[currentSegmentIndex].alternatives[0].words[nextWordIndex].startTime.seconds,
				transcript[currentSegmentIndex].alternatives[0].words[nextWordIndex].startTime.nanos
			)
			return nextWordStartTime - startTime
		}
		return 0
	}

	const findSegment = (
		[i, x]: number[],
		startTime: number
	) => {
		const segmentWords = []
		for (let y = i; y < transcript.length; y++) {
			const alternative = transcript[y]?.alternatives[0]
			if (!alternative || !alternative.words) {
				continue
			}

			for (let z = x; z < alternative.words.length; z++) {
				const { word, endTime } = alternative.words[z]
				segmentWords.push(word)
				if (normalizeString(word) === words[words.length - 1]) {
					possibleMatches.push({
						startTime,
						endTime: getSeconds(endTime.seconds, endTime.nanos),
						phrase: segmentWords.join(' '),
						endBufferSeconds: calculateEndBuffer(getSeconds(endTime.seconds, endTime.nanos), transcript, y, z),
					})
				}
			}
		}
	}

	for (let i = 0; i < transcript.length; i++) {
		const alternative = transcript[i]?.alternatives[0]
		if (!alternative || !alternative.words) {
			continue
		}

		for (let x = 0; x < alternative.words.length; x++) {
			const { word, startTime } = alternative.words[x]
			if (normalizeString(word) === words[0]) {
				findSegment([i, x], getSeconds(startTime.seconds, startTime.nanos))
			}
		}
	}

	const getBestMatchSegment = (segments: typeof possibleMatches) => {
		let bestMatch: number = 0
		let bestMatchDistance = Number.MAX_SAFE_INTEGER

		for (let i = 0; i < segments.length; i++) {
			const { phrase } = segments[i]
			const distance = levenshteinDistance(phrase, quote)
			if (distance < bestMatchDistance) {
				bestMatchDistance = distance
				bestMatch = i
			}
		}

		return segments[bestMatch]
	}

	if (possibleMatches.length > 1) {
		return getBestMatchSegment(possibleMatches)
	}

	return possibleMatches[0]
}

export const downloadVideoSegment = async (
	segment: {
		video_url?: string;
		date: string | Date;
	}
): Promise<string | null> => {
	if (!segment.video_url) {
		return null
	}

	const path = join(getCacheDirectory(), `${new Date(segment.date).getTime()}.webm`)

	if (fs.existsSync(path)) {
		logger.debug(`Using cached file for segment: ${segment.video_url}`)
		return path
	}

	const writeStream = fs.createWriteStream(path)
	const stream = await downloadFileStream(segment.video_url)

	return new Promise((resolve, reject) => {
		stream.pipe(writeStream)
		writeStream.on('error', (error) => {
			captureError(error)
			reject(error)
		})
		writeStream.on('finish', () => {
			logger.debug(`Completed download for segment: ${segment.video_url}`)
			resolve(path)
		})
	})
}

export const deleteCachedFiles = async (cachedFilePaths: string[]): Promise<void> => {
	await Promise.all(
		cachedFilePaths.map(async (filePath) => {
			if (fs.existsSync(filePath)) {
				return fs.promises.unlink(filePath)
					.then(() => {
						logger.info(`Successfully deleted cache file: ${filePath}`)
					})
					.catch((error) => {
						logger.error(`Failed to delete cache file: ${filePath}`)
						captureError(error)
					})
			} else {
				logger.warn(`Cache file not found, skipping deletion: ${filePath}`)
			}
		})
	)
}

export const mergeVideoSegments = async (conversation_history: ConversationHistory[]) => {
	const videoPaths: string[] = (await Promise.all(
		conversation_history.map(async ({ video_url, date }) => {
			try {
				if (video_url) {
					const path = join(getCacheDirectory(), `${new Date(date).getTime()}.webm`)
					await downloadFile(video_url, path)
					return path
				}
			} catch (error) {
				captureError(error)
				logger.error('Error downloading video', error)
			}
			return null
		})
	)).filter((path) => !!path)

	const mergedVideoPath = join(getCacheDirectory(), `${new Date().getTime()}.mp4`)
	await mergeAndConvertToMP4(videoPaths, mergedVideoPath)

	const thumbnailPath = join(getCacheDirectory(), `${new Date().getTime()}.png`)
	await generateThumbnail(mergedVideoPath, thumbnailPath)

	const [mergedVideoUrl, thumbnailUrl] = await Promise.all([
		uploadFileByPath(mergedVideoPath),
		uploadFileByPath(thumbnailPath),
	])

	return { mergedVideoUrl, thumbnailUrl }
}

export const convertTextScriptToFlow = async (script: string, teamId: string): Promise<{
	nodes: InterviewNode[]
	edges: InterviewEdge[]
}> => {
	const data = await withExponentialBackoff(() => azureAi({
		team_id: teamId,
		'Helicone-Property-Feature': 'Text to Flow',
		model: AzureOpenAIModels.GPT_4_O,
	}).chat.completions.create({
		model: OpenAIModels.GPT_4_O,
		messages: [{
			role: 'system',
			// eslint-disable-next-line max-len
			content: `The following is a script for a phone call. Your job is to transform this script into a directed acyclic graph (DAG) in JSON format. Each vertex in the DAG represents a step for the calling agent to say. The agent will then await the user's response. Each vertex should consist of multiple potential outcomes. These outcomes are possible responses given by a user and are connected to other vertices in the DAG via the 'edges' you provide. The agent will then choose the next vertex to proceed to based on the user's response. The agent will continue to do this until the call is complete. Ensure that you have provided multiple branches to ensure that every possibility in the conversation is accounted for.\n\n${script}`,
		}],
		tool_choice: {
			type: 'function',
			function: {
				name: 'generate_dag',
			},
		},
		tools: [
			{
				type: 'function',
				function: {
					name: 'generate_dag',
					description: 'Transform a text script into a directed acyclic graph (DAG) in JSON format.',
					parameters: {
						type: 'object',
						properties: {
							vertices: {
								type: 'array',
								description: 'An array of vertices, each representing a step in the call script for the agent to say.',
								items: {
									type: 'object',
									required: ['id', 'content', 'outcomes'],
									properties: {
										id: {
											type: 'string',
											description: 'A unique identifier for this vertex. This ID is used to reference the the vertex in the edges array.',
										},
										content: {
											type: 'string',
											description: 'The text or message that should be conveyed by the calling agent when the call reaches this node. It represents the script or instruction at this point. Should be max 50 characters.',
										},
										outcomes: {
											type: 'array',
											description: 'An array of possible responses that the user may give. Each outcome is a string. Required to have at least one outcome, except for the last vertex in the DAG.',
											items: {
												type: 'object',
												description: 'An outcome represents a possible response that the user may give. Each destination_id must be unique.',
												properties: {
													content: {
														type: 'string',
														description: 'In one or two words, the message that the user may say in response to the agent when the call reaches this node.',
													},
													destination_id: {
														type: 'string',
														description: 'The ID of the vertex that the agent should proceed to if the user responds with this outcome. Important: every destination_id must match the ID of a vertex in the vertices array. There cannot be any dangling edges.',
													},
												},
												required: ['content', 'destination_id'],
											},
										},
									},
								},
							},
						},
						required: ['vertices'],
					},
				},
			},
		],
	}))

	const args = JSON.parse(data.choices[0].message.tool_calls[0].function.arguments)

	logger.debug(`Generated DAG: ${JSON.stringify(args.vertices, null, 2)}`)

	const convertJSON = (originalJSON: any) => {
		const nodes: InterviewNode[] = []
		const edges: InterviewEdge[] = []

		originalJSON.forEach((vertex: any, index: number) => {
			const isStart = index === 0
			const isEnd = vertex.outcomes?.length === 0

			const node: InterviewNode = {
				id: vertex.id,
				position: { x: 100, y: 100 * (index + 1) }, // Example positioning logic
				data: {
					type: isStart ? 'start' : isEnd ? 'end' : 'segment',
					segment_type: 'question',
					description: vertex.content,
					outcomes: vertex.outcomes?.map((outcome: any) => outcome.content),
				},
				type: 'segment',
			}
			nodes.push(node)

			vertex.outcomes?.forEach((outcome: any) => {
				// dont create new edge from the same outcome
				const index = edges.findIndex(edge => edge.source === vertex.id)
				if (index !== -1 && edges[index].sourceHandle === `_${outcome.content}`) {
					return
				}

				const edge: InterviewEdge = {
					id: `${vertex.id}-${outcome.destination_id}`,
					source: vertex.id,
					sourceHandle: `_${outcome.content}`,
					target: outcome.destination_id,
					targetHandle: null,
				}
				edges.push(edge)
			})
		})

		return { nodes, edges }
	}

	const removeDisconnectedNodes = ({ nodes, edges }: { nodes: InterviewNode[], edges: InterviewEdge[] }): { nodes: InterviewNode[], edges: InterviewEdge[] } => {
		const connectedNodeIds = new Set<string>()

		// Add all source and target nodes from edges to the set
		edges.forEach(edge => {
			connectedNodeIds.add(edge.source)
			connectedNodeIds.add(edge.target)
		})

		// Filter out nodes that are not in the connectedNodeIds set
		const filteredNodes = nodes.filter(node => connectedNodeIds.has(node.id))

		return { nodes: filteredNodes, edges }
	}

	const results = convertJSON(args.vertices)
	const { nodes, edges } = removeDisconnectedNodes(results)

	return layoutNodesAndEdges(nodes, edges)
}

export const prepareTagForComparison = (tag: string) => tag.toLowerCase().replace(/[^\w\s]|_/g, '').trim()

export function calculateMetrics(metrics, responses) {
	const responseStatusCounts = responses.reduce((acc, response) => {
		acc[response.status] = (acc[response.status] || 0) + 1
		return acc
	}, {})

	const responseTagCounts = {}
	responses.forEach(response => {
		const tags = response.summary_data?.response_tags ?? []
		tags.forEach(tag => {
			responseTagCounts[tag] = (responseTagCounts[tag] || 0) + 1
		})
	})

	const totalDurationMs = responses.reduce((acc, response) => {
		const duration = parseInt(response.duration_ms) || 0
		return acc + duration
	}, 0)

	const totalCount = responses.length

	return metrics.map(metric => {
		let number_value = 0

		switch (metric.type) {
			case MetricType.STATUS: {
				switch (metric.value) {
					case StatusMetric.TOTAL_RESPONSES:
						number_value = totalCount
						break
					case StatusMetric.PICKUP_RATE: {
						const specificCount = responseStatusCounts.ENDED || 0
						const baseCount = totalCount || 1 // Avoid division by zero
						number_value = baseCount > 0 ? Math.round((specificCount / baseCount) * 100) : 0
						break
					}
					case StatusMetric.DURATION:
						if (metric.method === MetricMethod.SUM) {
							number_value = parseFloat((totalDurationMs / 1000).toFixed(2)) // Convert ms to seconds
						} else if (metric.method === MetricMethod.AVERAGE) {
							number_value = totalCount ? parseFloat(((totalDurationMs / totalCount) / 1000).toFixed(2)) : 0 // Convert ms to seconds
						}
						break
					default: {
						const count = responseStatusCounts[metric.value] || 0
						number_value = count
						break
					}
				}
				break
			}
			case MetricType.TAG: {
				if (metric.method === MetricMethod.SUM) {
					number_value = responseTagCounts[metric.value] || 0
				} else if (metric.method === MetricMethod.AVERAGE) {
					number_value = totalCount ? parseFloat((responseTagCounts[metric.value] / totalCount).toFixed(2)) : 0
				} else {
					const count = responseTagCounts[metric.value] || 0
					const baseCount = metric.base ? (responseStatusCounts[metric.base] || totalCount) : totalCount
					number_value = baseCount > 0 ? Math.round((count / baseCount) * 100) : 0
				}
				break
			}
		}

		return {
			...metric,
			number_value,
		}
	})
}
