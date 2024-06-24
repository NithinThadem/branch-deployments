/* eslint-disable max-len */
import { Socket } from 'socket.io'
import logger from '../../../util/logger.util'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { captureError } from '../../../util/error.util'
import { generateSignedUploadUrl, uploadBase64 } from '../../../services/google/storage'
import {
	chatCompletionIterator, getDataPointsForNode, getLastUserMessages, getMessagesForCompletion, getStepNumber,
} from './public.helpers'
import ElevenLabs from '../../../services/elevenlabs'
import { voiceIdFromName, voiceModelFromLanguage } from '../../interview/api/interview.helpers'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { getDeepgram, getModelByLanguage } from '../../../services/deepgram'
import { LiveTranscription } from '@deepgram/sdk/dist/transcription/liveTranscription'
import { Index } from '@pinecone-database/pinecone'
import { getMessagesForPineconeQuery, getPineconeIndex, queryPinecone } from '../../genius/db/genius.helpers'
import {
	handleCompletionDataResponse, handleSecondaryActions, transformFunctionsToParams, transformScriptToMermaid,
} from '../../interview-flow/db/interview-flow.helpers'
import { InterviewLanguage } from '../../interview/db/interview.types'
import analytics from '../../../services/segment'
import { DataPointValueType } from '../../data-point/db/data-point.types'
import { DataPointEntity } from '../../data-point/db/data-point.entity'
import { DataPointType } from '../../data-point/db/data-point.types'
import { InterviewNode, InterviewFunctionName } from '../../interview-flow/db/interview-flow.types'

export const onTranscriptionSocket = async (socket: Socket) => {
	let transcriptionStream: LiveTranscription | null = null

	const _end = () => {
		logger.debug('Ending transcription stream')
		transcriptionStream?.send(JSON.stringify({
			type: 'CloseStream',
		}))
		transcriptionStream = null
	}

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	const _init = (lang: string = 'en',) => {
		logger.debug(`Initializing transcription stream: ${lang}`)
		transcriptionStream = getDeepgram().transcription.live({
			smart_format: false,
			interim_results: true,
			language: lang,
			model: getModelByLanguage(InterviewLanguage[lang]),
			endpointing: 500,
			filler_words: true,
			// keywords: [], https://developers.deepgram.com/docs/keywords
		})
			.addListener('transcriptReceived', (message) => {
				const data = JSON.parse(message)
				if (data.type === 'Results') {
					logger.debug(`Received transcript data: ${data.channel.alternatives[0].transcript}`)
					socket.emit('data', data)
				} else {
					logger.debug(`Received transcript data: ${JSON.stringify(data, null, 2)}`)
				}
			})
			.addListener('close', () => {
				logger.debug('Transcription stream closed')
				transcriptionStream = null
			})
			.addListener('open', () => {
				logger.debug('Transcription stream connected')
			})
			.addListener('error', (error) => {
				_onError(error)
			})
	}

	socket.on('end', () => {
		_end()
	})

	let dataQueue = []

	socket.on('data', async (data) => {
		if (!transcriptionStream) {
			_init(data.lang)
		}
		if (transcriptionStream.getReadyState() !== 1) {
			dataQueue.push(data.audio)
		} else {
			dataQueue.forEach((queueItem, index) => {
				logger.debug(`Sending ${index + 1}/${dataQueue.length} queued audio chunks`)
				transcriptionStream?.send(queueItem)
			})
			dataQueue = []
			transcriptionStream?.send(data.audio)
		}
	})

	socket.on('disconnect', () => {
		_end()
	})

	if (typeof socket.handshake.query.lang === 'string') {
		logger.debug(`Received language: ${socket.handshake.query.lang}`)
		_init(socket.handshake.query.lang)
	}
}

type CallSegmentPayload = {
	transcript: string
	next_topic: boolean
	cumulative_duration_ms: number
}

export const onCallSocket = async (socket: Socket) => {
	let interviewResponse: InterviewResponseEntity | null = null
	let pineconeIndex: Index | null = null
	let interimAnalysis = null

	let lastUserStopTalkingTime = 0
	let openAIResponseTime = 0
	let elevenLabsSendTime = 0
	let shouldEndCall = false

	const blankValueTracker: { nodeId: string; value: string }[] = []
	let lastCompletedNode: InterviewNode
	const secondaryActionOutputs = []
	let answer: string

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	const _onInterviewResponseId = async (interview_response_id: string) => {
		if (interviewResponse?.id !== interview_response_id) {
			interviewResponse = await InterviewResponseEntity.findOneOrFail({
				where: {
					id: interview_response_id,
				},
				relations: ['interview', 'team', 'interview.flow', 'interview.team'],
			})
			if (interviewResponse.interview.genius_id) {
				logger.info(`Getting Pinecone index for genius ${interviewResponse.interview.genius_id}`)
				pineconeIndex = getPineconeIndex(interviewResponse.interview.genius_id)
			}
		}
	}

	const _onSegment = async (segment: CallSegmentPayload) => {
		try {
			if (!interviewResponse) {
				throw new Error('Interview response not found')
			}

			const startDate = new Date().getTime()
			lastUserStopTalkingTime = new Date().getTime()

			if (interviewResponse.interview && interviewResponse.interview.flow && interviewResponse.interview.flow.nodes && interviewResponse.interview.flow.nodes.length > 0 && !lastCompletedNode) {
				const startNode = interviewResponse.interview.flow.nodes.find(node => node.data && node.data.type === 'start')

				lastCompletedNode = startNode
			}

			logger.info(`User finished speaking: ${segment.transcript}`)

			const { signedUrl, uploadedUrl } = await generateSignedUploadUrl('webm', 'video/webm')

			socket.emit('data', {
				signed_url: signedUrl,
			})
			const cumulative_duration_ms = interviewResponse.conversation_history[
				interviewResponse.conversation_history.length - 1
			].cumulative_duration_ms + segment.cumulative_duration_ms

			interviewResponse.conversation_history.push({
				date: new Date(),
				author: 'user',
				text: segment.transcript,
				video_url: uploadedUrl,
				cumulative_duration_ms,
			})

			logger.debug(`Running AI response to transcript: ${segment.transcript}`)

			const audioChunks: Buffer[] = []
			let aiResponse = ''

			logger.debug(`Time to get prompt: ${new Date().getTime() - startDate}ms`)

			const shouldUsePinecone = pineconeIndex && interviewResponse.conversation_history.length > 2

			const [
				elevenLabsSocket,
				vectorResponse,
			] = await Promise.all([
				ElevenLabs.getElevenLabsWebSocket({
					voiceId: voiceIdFromName(interviewResponse.ai_name).id,
					model: voiceModelFromLanguage(interviewResponse.interview.lang),
					onError: (error) => {
						throw error
					},
					onOpen: () => {
						logger.debug(`Time to open ElevenLabs socket: ${new Date().getTime() - startDate}ms`)
					},
					onMessage: async (event) => {
						const response = JSON.parse(event.data)

						if (response.audio) {
							logger.debug(`Time to get ElevenLabs audio response (#${audioChunks.length + 1}): ` +
								`${new Date().getTime() - startDate}ms`)
							audioChunks.push(Buffer.from(response.audio, 'base64'))
							socket.emit('data', {
								audio: response.audio,
							})
						} else {
							logger.warn(`Received unknown ElevenLabs response: ${JSON.stringify(response, null, 2)}`)
						}

						if (response.isFinal) {
							logger.debug(`Time to get ElevenLabs final response: ${new Date().getTime() - startDate}ms`)

							interviewResponse.conversation_history.push({
								date: new Date(),
								author: 'ai',
								text: aiResponse,
								cumulative_duration_ms,
								audio_url: await uploadBase64('mp3', Buffer.concat(audioChunks).toString('base64')),
								completion_data: { node_id: matchingNode.id || '' },
							})

							logger.debug('Saving interview')

							socket.emit('data', {
								interview_response: interviewResponse,
							})

							await interviewResponse.save()
						}
					},
				}),
				shouldUsePinecone && queryPinecone(
					getMessagesForPineconeQuery(interviewResponse.conversation_history),
					pineconeIndex,
					7,
				),
			])

			logger.debug(`Time to get ElevenLabs socket: ${new Date().getTime() - startDate}ms`)

			if (lastCompletedNode && lastCompletedNode.id && String(lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				// LLM call to get the answer
				answer = await getDataPointsForNode({
					node: lastCompletedNode,
					userAnswer: segment.transcript,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
				// Create a new data point
				DataPointEntity.create({
					response_id: interviewResponse.id,
					interview_id: interviewResponse.interview.id,
					team_id: interviewResponse.team.id,
					response_type: interviewResponse.type,
					type: DataPointType.QUESTION_NODE,
					node_id: lastCompletedNode.id,
					value: answer,
					value_type: lastCompletedNode.data.outcomes?.includes(answer) ? DataPointValueType.STRICT : DataPointValueType.OTHER,
					metadata: {
						node_data: lastCompletedNode.data,
					},
				}).save()
				// Find the entry in the blank value tracker that corresponds to the last completed node
				const trackerEntry = blankValueTracker.find(entry => entry.nodeId === lastCompletedNode.id)

				if (trackerEntry) {
					// Update the value if it's already in the tracker
					trackerEntry.value = answer
				} else {
					// Add a new entry if it's not in the tracker
					blankValueTracker.push({ nodeId: lastCompletedNode.id, value: answer })
				}

				await handleSecondaryActions({
					nodes: interviewResponse.interview.flow.nodes,
					edges: interviewResponse.interview.flow.edges,
					contact: interviewResponse.contact,
					blankValueTracker,
					lastCompletedNode,
					userAnswer: segment.transcript,
					secondaryActionOutputs,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			const { labelToNodeIdMap, mermaidGraph } = transformScriptToMermaid({
				nodes: interviewResponse.interview.flow.nodes,
				edges: interviewResponse.interview.flow.edges,
				fn_params: transformFunctionsToParams(interviewResponse.interview.flow.functions),
				blankValueTracker,
				lang: interviewResponse.interview.lang,
				metadata: interviewResponse.metadata,
				contact: interviewResponse.contact,
			})

			const [
				completionPromise,
			] = await withExponentialBackoff(
				() => chatCompletionIterator({
					messages: getMessagesForCompletion({
						vectorResponse,
						conversation_history: interviewResponse.conversation_history,
					}),
					timeoutMs: 5000,
					interimAnalysis,
					responseId: interviewResponse.id,
					interviewId: interviewResponse.interview.id,
					script: mermaidGraph,
					teamId: interviewResponse.team_id,
					secondaryActionOutputs,
				})
			)
			interimAnalysis = null

			const completion = await completionPromise

			for await (const text of completion) {
				logger.debug(`Time to get AI response: ${new Date().getTime() - startDate}ms | ${text}`)
				if (!openAIResponseTime) {
					openAIResponseTime = new Date().getTime()
				}
				elevenLabsSocket.send(JSON.stringify({ text, try_trigger_generation: true }))
				aiResponse += text
				socket.emit('data', {
					text: aiResponse,
				})
			}

			logger.debug(`Time to get AI response: ${new Date().getTime() - startDate}ms | ${aiResponse}`)

			elevenLabsSendTime = new Date().getTime()
			elevenLabsSocket.send(JSON.stringify({ text: '' }))

			const userToOpenAILatency = openAIResponseTime - lastUserStopTalkingTime
			const openAIToElevenLabsLatency = elevenLabsSendTime - openAIResponseTime

			try {
				analytics.track({
					userId: 'system',
					event: 'User to OpenAI Latency',
					properties: {
						distinct_id: interviewResponse.id,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: userToOpenAILatency,
						team_id: interviewResponse.interview.team.id,
					},
				})
				analytics.track({
					userId: 'system',
					event: 'OpenAI to Eleven Labs Send Latency',
					properties: {
						distinct_id: interviewResponse.id,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: openAIToElevenLabsLatency,
						team_id: interviewResponse.interview.team.id,
					},
				})
			} catch (error) {
				captureError(error)
			}

			let nodeId = lastCompletedNode.id
			const stepNumber = await getStepNumber(getLastUserMessages(interviewResponse.conversation_history), aiResponse, mermaidGraph, interviewResponse.interview.id, interviewResponse.interview.flow.edges)

			if (stepNumber !== -1) {
				nodeId = labelToNodeIdMap[stepNumber]
			}
			const matchingNode = interviewResponse.interview.flow.nodes.find(node => node.id === nodeId)

			// Update the last completed node to the matching node
			lastCompletedNode = matchingNode
			const result = await handleCompletionDataResponse({
				matchingNode,
			}).catch(captureError)

			if (typeof result === 'object' && '_shouldEndCall' in result) {
				const { _shouldEndCall } = result
				shouldEndCall = _shouldEndCall
			}
			if (shouldEndCall) {
				logger.info('Emitting end call')
				socket.emit('end_call')
			}
		} catch (error) {
			_onError(error)
		}
	}

	socket.on('data', async (data) => {
		try {
			logger.debug(`Received data: ${JSON.stringify(data, null, 2)}`)
			if (data.interview_response_id) {
				await _onInterviewResponseId(data.interview_response_id)
			}
			if (data.segment) {
				await _onSegment(data.segment)
			}
		} catch (error) {
			_onError(error)
		}
	})
}

export const onChatSocket = async (socket: Socket) => {
	let interviewResponse: InterviewResponseEntity | null = null
	let pineconeIndex: Index | null = null
	let interimAnalysis = null

	let lastUserStopTalkingTime = 0
	let openAIResponseTime = 0
	let shouldEndCall = false

	const blankValueTracker: { nodeId: string; value: string }[] = []
	let lastCompletedNode: InterviewNode
	const secondaryActionOutputs = []
	let answer: string

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	socket.on('message', async (message: string) => {
		try {
			if (!interviewResponse) {
				throw new Error('Interview response not found')
			}
			lastUserStopTalkingTime = new Date().getTime()

			if (interviewResponse.interview && interviewResponse.interview.flow && interviewResponse.interview.flow.nodes && interviewResponse.interview.flow.nodes.length > 0 && !lastCompletedNode) {
				const startNode = interviewResponse.interview.flow.nodes.find(node => node.data && node.data.type === 'start')

				lastCompletedNode = startNode
			}

			interviewResponse.conversation_history.push({
				author: 'user',
				text: message,
				date: new Date(),
			})

			const shouldUsePinecone = pineconeIndex && interviewResponse.conversation_history.length > 2
			let vectorResponse

			if (shouldUsePinecone) {
				vectorResponse = await queryPinecone(
					getMessagesForPineconeQuery(interviewResponse.conversation_history),
					pineconeIndex,
					7,
				)
			}
			// Generate the answer for the last node based on the user's response if it's not an API call
			if (lastCompletedNode && lastCompletedNode.id && String(lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				// LLM call to get the answer
				answer = await getDataPointsForNode({
					node: lastCompletedNode,
					userAnswer: message,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
				// Create a new data point
				DataPointEntity.create({
					response_id: interviewResponse.id,
					interview_id: interviewResponse.interview.id,
					team_id: interviewResponse.team.id,
					response_type: interviewResponse.type,
					type: DataPointType.QUESTION_NODE,
					node_id: lastCompletedNode.id,
					value: answer,
					value_type: lastCompletedNode.data.outcomes?.includes(answer) ? DataPointValueType.STRICT : DataPointValueType.OTHER,
					metadata: {
						node_data: lastCompletedNode.data,
					},
				}).save()
				// Find the entry in the blank value tracker that corresponds to the last completed node
				const trackerEntry = blankValueTracker.find(entry => entry.nodeId === lastCompletedNode.id)

				if (trackerEntry) {
					// Update the value if it's already in the tracker
					trackerEntry.value = answer
				} else {
					// Add a new entry if it's not in the tracker
					blankValueTracker.push({ nodeId: lastCompletedNode.id, value: answer })
				}

				await handleSecondaryActions({
					nodes: interviewResponse.interview.flow.nodes,
					edges: interviewResponse.interview.flow.edges,
					contact: interviewResponse.contact,
					blankValueTracker,
					lastCompletedNode,
					userAnswer: message,
					secondaryActionOutputs,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			let fullResponse = ''
			const { labelToNodeIdMap, mermaidGraph } = transformScriptToMermaid({
				nodes: interviewResponse.interview.flow.nodes,
				edges: interviewResponse.interview.flow.edges,
				fn_params: transformFunctionsToParams(interviewResponse.interview.flow.functions),
				blankValueTracker,
				lang: interviewResponse.interview.lang,
				metadata: interviewResponse.metadata,
				contact: interviewResponse.contact,
			})

			const [
				completionPromise,
			] = await withExponentialBackoff(
				() => chatCompletionIterator({
					messages: getMessagesForCompletion({
						vectorResponse,
						conversation_history: interviewResponse.conversation_history,
					}),
					timeoutMs: 5000,
					interimAnalysis,
					responseId: interviewResponse.id,
					interviewId: interviewResponse.interview.id,
					script: mermaidGraph,
					teamId: interviewResponse.team_id,
					secondaryActionOutputs,
				})
			)

			interimAnalysis = null

			const completion = await completionPromise

			for await (const aiText of completion) {
				if (!openAIResponseTime) {
					openAIResponseTime = new Date().getTime()
				}
				fullResponse += aiText
				socket.emit('interim_message', fullResponse)
			}

			const userToOpenAILatency = openAIResponseTime - lastUserStopTalkingTime

			try {
				analytics.track({
					userId: 'system',
					event: 'User to OpenAI Latency',
					properties: {
						distinct_id: interviewResponse.id,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: userToOpenAILatency,
						team_id: interviewResponse.interview.team.id,
					},
				})
			} catch (error) {
				captureError(error)
			}

			let nodeId = lastCompletedNode.id
			const stepNumber = await getStepNumber(getLastUserMessages(interviewResponse.conversation_history), fullResponse, mermaidGraph, interviewResponse.interview.id, interviewResponse.interview.flow.edges)
			if (stepNumber !== -1) {
				nodeId = labelToNodeIdMap[stepNumber]
			}
			const matchingNode = interviewResponse.interview.flow.nodes.find(node => node.id === nodeId)

			// Update the last completed node to the matching node
			lastCompletedNode = matchingNode

			const result = await handleCompletionDataResponse({
				matchingNode,
			}).catch(captureError)
			if (typeof result === 'object' && '_shouldEndCall' in result) {
				const { _shouldEndCall } = result
				shouldEndCall = _shouldEndCall
			}
			if (shouldEndCall) {
				logger.info('Emitting end call')
				socket.emit('end_chat')
			}
			interviewResponse.conversation_history.push({
				date: new Date(),
				author: 'ai',
				text: fullResponse,
				completion_data: { node_id: matchingNode.id || '' },
			})

			await interviewResponse.save()

			socket.emit('data', interviewResponse)
		} catch (error) {
			_onError(error)
		}
	})

	socket.on('disconnect', () => {
		logger.debug(`Chat socket disconnected: ${socket.handshake.query.interview_response_id}`)
	})

	if (typeof socket.handshake.query.interview_response_id !== 'string') {
		throw new Error('Interview ID not provided')
	}

	interviewResponse = await InterviewResponseEntity.findOneOrFail({
		where: { id: socket.handshake.query.interview_response_id },
		relations: ['interview', 'interview.team', 'interview.flow', 'contact', 'team'],
	})

	socket.emit('data', interviewResponse)

	if (interviewResponse.interview.genius_id) {
		logger.info(`Getting Pinecone index for genius ${interviewResponse.interview.genius_id}`)
		pineconeIndex = getPineconeIndex(interviewResponse.interview.genius_id)
	}

	logger.debug(`Chat socket connected: ${socket.handshake.query.interview_response_id}`)
}

export const onWidgetSocket = async (socket: Socket) => {
	let interviewResponse: InterviewResponseEntity | null = null
	let pineconeIndex: Index | null = null
	let interimAnalysis = null

	let lastUserStopTalkingTime = 0
	let openAIResponseTime = 0

	const blankValueTracker: { nodeId: string; value: string }[] = []
	let lastCompletedNode: InterviewNode
	const secondaryActionOutputs = []
	let answer: string

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	socket.on('message', async (message: string) => {
		try {
			if (!interviewResponse) {
				throw new Error('Interview response not found')
			}

			if (interviewResponse.interview && interviewResponse.interview.flow && interviewResponse.interview.flow.nodes && interviewResponse.interview.flow.nodes.length > 0 && !lastCompletedNode) {
				const startNode = interviewResponse.interview.flow.nodes.find(node => node.data && node.data.type === 'start')

				lastCompletedNode = startNode
			}

			lastUserStopTalkingTime = new Date().getTime()

			interviewResponse.conversation_history.push({
				author: 'user',
				text: message,
				date: new Date(),
			})

			const shouldUsePinecone = pineconeIndex && interviewResponse.conversation_history.length > 2
			let vectorResponse

			if (shouldUsePinecone) {
				vectorResponse = await queryPinecone(
					getMessagesForPineconeQuery(interviewResponse.conversation_history),
					pineconeIndex,
					7,
				)
			}

			// Generate the answer for the last node based on the user's response if it's not an API call
			if (lastCompletedNode && lastCompletedNode.id && String(lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				// LLM call to get the answer
				answer = await getDataPointsForNode({
					node: lastCompletedNode,
					userAnswer: message,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
				// Create a new data point
				DataPointEntity.create({
					response_id: interviewResponse.id,
					interview_id: interviewResponse.interview.id,
					team_id: interviewResponse.team.id,
					response_type: interviewResponse.type,
					type: DataPointType.QUESTION_NODE,
					node_id: lastCompletedNode.id,
					value: answer,
					value_type: lastCompletedNode.data.outcomes?.includes(answer) ? DataPointValueType.STRICT : DataPointValueType.OTHER,
					metadata: {
						node_data: lastCompletedNode.data,
					},
				}).save()
				// Find the entry in the blank value tracker that corresponds to the last completed node
				const trackerEntry = blankValueTracker.find(entry => entry.nodeId === lastCompletedNode.id)

				if (trackerEntry) {
					// Update the value if it's already in the tracker
					trackerEntry.value = answer
				} else {
					// Add a new entry if it's not in the tracker
					blankValueTracker.push({ nodeId: lastCompletedNode.id, value: answer })
				}

				await handleSecondaryActions({
					nodes: interviewResponse.interview.flow.nodes,
					edges: interviewResponse.interview.flow.edges,
					contact: interviewResponse.contact,
					blankValueTracker,
					lastCompletedNode,
					userAnswer: message,
					secondaryActionOutputs,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			let fullResponse = ''
			const { labelToNodeIdMap, mermaidGraph } = transformScriptToMermaid({
				nodes: interviewResponse.interview.flow.nodes,
				edges: interviewResponse.interview.flow.edges,
				fn_params: transformFunctionsToParams(interviewResponse.interview.flow.functions),
				blankValueTracker,
				lang: interviewResponse.interview.lang,
				metadata: interviewResponse.metadata,
				contact: interviewResponse.contact,
			})

			const [
				completionPromise,
			] = await withExponentialBackoff(
				() => chatCompletionIterator({
					messages: getMessagesForCompletion({
						vectorResponse,
						conversation_history: interviewResponse.conversation_history,
					}),
					timeoutMs: 5000,
					interimAnalysis,
					responseId: interviewResponse.id,
					interviewId: interviewResponse.interview.id,
					script: mermaidGraph,
					teamId: interviewResponse.team_id,
					secondaryActionOutputs,
				})
			)

			interimAnalysis = null

			const completion = await completionPromise

			for await (const aiText of completion) {
				if (!openAIResponseTime) {
					openAIResponseTime = new Date().getTime()
				}
				fullResponse += aiText
				socket.emit('interim_message', fullResponse)
			}

			const userToOpenAILatency = openAIResponseTime - lastUserStopTalkingTime

			try {
				analytics.track({
					userId: 'system',
					event: 'User to OpenAI Latency',
					properties: {
						distinct_id: interviewResponse.id,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: userToOpenAILatency,
						team_id: interviewResponse.interview.team.id,
					},
				})
			} catch (error) {
				captureError(error)
			}

			let nodeId = lastCompletedNode.id
			const stepNumber = await getStepNumber(getLastUserMessages(interviewResponse.conversation_history), fullResponse, mermaidGraph, interviewResponse.interview.id, interviewResponse.interview.flow.edges)
			if (stepNumber !== -1) {
				nodeId = labelToNodeIdMap[stepNumber]
			}
			const matchingNode = interviewResponse.interview.flow.nodes.find(node => node.id === nodeId)

			await handleCompletionDataResponse({
				matchingNode,
			}).catch(captureError)

			interviewResponse.conversation_history.push({
				date: new Date(),
				author: 'ai',
				text: fullResponse,
				completion_data: { node_id: matchingNode.id || '' },
			})

			await interviewResponse.save()

			socket.emit('data', interviewResponse)
		} catch (error) {
			_onError(error)
		}
	})

	socket.on('disconnect', () => {
		logger.debug(`Chat socket disconnected: ${socket.handshake.query.interview_response_id}`)
	})

	if (typeof socket.handshake.query.interview_response_id !== 'string') {
		throw new Error('Interview ID not provided')
	}

	interviewResponse = await InterviewResponseEntity.findOneOrFail({
		where: { id: socket.handshake.query.interview_response_id },
		relations: ['interview', 'interview.team', 'interview.flow', 'team'],
	})

	socket.emit('data', interviewResponse)

	if (interviewResponse.interview.genius_id) {
		logger.info(`Getting Pinecone index for genius ${interviewResponse.interview.genius_id}`)
		pineconeIndex = getPineconeIndex(interviewResponse.interview.genius_id)
	}

	logger.debug(`Widget socket connected: ${socket.handshake.query.interview_response_id}`)
}
