/* eslint-disable max-len */
import { LiveTranscription } from '@deepgram/sdk/dist/transcription/liveTranscription'
import logger from '../../../util/logger.util'
import { getDeepgram, getModelByLanguage } from '../../../services/deepgram'
import { captureError } from '../../../util/error.util'
import { WebSocket } from 'ws'
import { InterviewResponseStatus, InterviewResponseType } from '../../interview-response/db/interview-response.types'
import { LiveTranscriptionResponse } from '@deepgram/sdk/dist/types'
import { twilioClientWithArgs } from '../../../services/twilio'
import ElevenLabs from '../../../services/elevenlabs'
import { withExponentialBackoff } from '../../../util/helpers.util'
import {
	chatCompletionIterator, getDataPointsForNode, getLastUserMessages, getMessagesForCompletion, getStepNumber,
} from '../../public/api/public.helpers'
import { downloadFileStream } from '../../../services/google/storage'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { voiceIdFromName, voiceModelFromLanguage } from '../../interview/api/interview.helpers'
import { onInterviewEnd } from '../../interview-response/api/interview-response.helpers'
import {
	handleCompletionDataResponse, handleSecondaryActions, transformFunctionsToParams, transformScriptToMermaid,
} from '../../interview-flow/db/interview-flow.helpers'
import { getMessagesForPineconeQuery, getPineconeIndex, queryPinecone } from '../../genius/db/genius.helpers'
import { Index } from '@pinecone-database/pinecone'
import { InterviewLanguage } from '../../interview/db/interview.types'
import analytics from '../../../services/segment'
import CallMediaQueue from './call-media-queue'
import { getAndFireWebhooks } from '../../webhook/db/webhook.helpers'
import { WebhookEventType } from '../../webhook/db/webhook.types'
import { formatTranscript } from '../../interview-response/api/interview-response.helpers'
import { matchesVoicemailPhrase } from './call.helpers'
import { InterviewFunctionName, InterviewNode } from '../../../modules/interview-flow/db/interview-flow.types'
import { DataPointEntity } from '../../../modules/data-point/db/data-point.entity'
import { DataPointType } from '../../../modules/data-point/db/data-point.types'
import { DataPointValueType } from '../../../modules/data-point/db/data-point.types'
import { usei18n, translate } from '../../../services/i18n'
import * as VoiceResponse from 'twilio/lib/twiml/VoiceResponse'
import { redisDelete, redisRead, redisWrite } from '../../../services/redis'

// These are interruption words that
const kIgnoreInterruptWordsInEnglish = new Set<string>([
	'uh-huh', 'mhmm', 'hmm',
	'yeah', 'yep', 'yes',
	'right',
	'ok', 'okay',
	'sure', 'yes',
	'uh', 'huh',
	'ah', 'ah-ha', 'aha',
	'oh', 'oh-oh', 'ohh',
])

/**
 * Twilio websocket handler function
 *
 * @param socket WebSocket instance
 */
const onTwilioSocket = async (socket: WebSocket) => {
	// Ignore these words when determining if the user should interrupt the agent
	let ignoreInterruptWords: Set<string> = new Set<string>()

	// Twilio call data
	let streamSid = ''
	let phoneNumberTo = ''
	let phoneNumberFrom = ''
	let interviewResponseId = ''
	let callSid = ''
	let accountSid = ''

	// Transcription variables
	let lastTranscriptChangeTime = new Date().getTime()
	let transcriptionStream: LiveTranscription | null = null
	let isTranscribing = false
	let interimTranscript = ''
	let interimAnalysis = null
	// Interview variables
	let interviewResponse: InterviewResponseEntity | null = null
	let lang: string = 'en'
	// Pinecone variables
	let pineconeIndex: Index | null = null
	// Call variables
	let shouldEndCall: boolean = false
	let shouldTransferCallTo: string = null
	let shouldTransferAgentTo: string = null
	let actionDetail = null
	let lastTimeUserStartedSpeaking: Date = null
	let didSystemInitiateHangup = false
	let callMediaQueue: CallMediaQueue = null
	let lastUserStopTalkingTime = 0
	let isRepeating = true
	let answeredBy = 'human'

	const shouldContinueWithCompletion = (dateUserStartedSpeaking: Date) =>
		(!isTranscribing && dateUserStartedSpeaking === lastTimeUserStartedSpeaking) || isRepeating

	// ElevenLabs variables
	let openAIResponseTime = 0
	let elevenLabsSendTime = 0
	let presenceInterimAudio: boolean = false
	let elevenLabsText = ''
	let chunkSequence = 0
	const audioChunkMap = new Map()
	let completionData = null
	let isNewAISpeechSegment = true
	let textChunk
	let userInterrupted = false
	let agentTryLimit = 5
	let remainingAgentTryLimit = agentTryLimit
	let agentSpeakingState = false
	let agentSpeakingStartTime = 0

	const blankValueTracker: { nodeId: string; value: string }[] = []
	let lastCompletedNode: InterviewNode
	const secondaryActionOutputs = []

	// Deepgram audio queue while disconnected
	const audioQueue = []

	// Deepgram audio queue settings
	const audioQueueMaxSize = 2000
	const audioQueueWarningThreshold = 400

	// Deepgram transcription connection state
	enum ConnectionState {
		CONNECTING = 0,
		OPEN = 1,
		CLOSING = 2,
		CLOSED = 3
	}

	const silenceTimeoutDuration = 3000 // 3 seconds
	let silenceTimeout: NodeJS.Timeout = null

	// Did the caller use a word that we can ignore when determining if the caller should interrupt the agent
	const isUserWordIgnorable = (word: string): boolean => word && ignoreInterruptWords.has(word.toLowerCase())

	// Create interruptable words for the target language
	const createInterruptableWordsForLanguage = (lang: InterviewLanguage): void => {
		const translated = new Set<string>()

		usei18n()

		for (const word of kIgnoreInterruptWordsInEnglish) {
			const translatedWord = translate(word, null, { lang: lang })
			logger.debug(`Fetching interrupt word for ${lang}: ${word} -> ${translatedWord}`)
			translated.add(translatedWord)
		}

		logger.info(`Ignorable interrupt words for ${lang}: ${Array.from(translated).join(', ')}`)

		ignoreInterruptWords = translated
	}

	const setUserInterrupted = (value: boolean): void => {
		if (userInterrupted !== value) {
			userInterrupted = value
			logger.info(`User interrupted set to: ${value}`)
		}
	}

	const getUserInterrupted = (): boolean => {
		logger.debug(`User interrupted value: ${userInterrupted}`)
		return userInterrupted
	}

	const setAgentSpeaking = (value: boolean): void => {
		if (agentSpeakingState !== value) {
			agentSpeakingState = value

			if (value) {
				agentSpeakingStartTime = performance.now()
				logger.info('Agent started speaking')
			} else {
				const agentSpeakingDuration = (performance.now() - agentSpeakingStartTime) / 1000
				logger.info(`Agent spoke for ${agentSpeakingDuration} sec`)
			}
		}
	}

	const isAgentSpeaking = (): boolean => {
		logger.info(`Agent speaking: ${agentSpeakingState}`)
		return agentSpeakingState
	}

	const clearSilenceTimeout = (): void => {
		if (silenceTimeout) {
			clearTimeout(silenceTimeout)
			silenceTimeout = null
			logger.debug('Cleared silence timeout')
		}
	}

	/**
	 * Start silence timeout helper function
	 * If user does not speak for 3 seconds, end the call
	 */
	const startSilenceTimeout = async () => {
		clearSilenceTimeout()

		remainingAgentTryLimit--
		if (remainingAgentTryLimit === 0) {
			// end the call
			if (answeredBy === 'not-human' && interviewResponse) {
				interviewResponse.status = InterviewResponseStatus.NO_ANSWER
				await interviewResponse.save()
			}

			logger.debug(`Agent tried initiating ${agentTryLimit} times, no respond from the user. Ending the call.`)
			await _onHangup()
			return
		}

		if (isAgentSpeaking()) {
			logger.debug('*** Agent is speaking, not starting silence timeout')
		} else {
			logger.info(`Agent is not speaking. reinitiate ${remainingAgentTryLimit} more times`)
			silenceTimeout = setTimeout(() => {
				// reinitiate the ai
				isRepeating = true
				if (remainingAgentTryLimit === 1) {
					_onFinishTalking('** silence, user has not spoken in a while, say goodbye and end the call **', new Date(), 'system')
				} else {
					_onFinishTalking('** silence, user does not speak **', new Date(), 'system')
				}
			}, silenceTimeoutDuration)
		}
	}

	/**
	 * Finish talking helper function
	 *
	 * @param transcript transcript of the user's last speech
	 * @param dateUserStartedSpeaking Date when the user started speaking
	 * @param author user|system|ai author of the transcription
	 */
	const _onFinishTalking = async (transcript: string, dateUserStartedSpeaking: Date, author: 'user' | 'system' | 'ai' = 'user') => {
		try {
			lastUserStopTalkingTime = new Date().getTime()
			const startDate = new Date().getTime()
			isTranscribing = false
			interimTranscript = ''
			isNewAISpeechSegment = true
			setUserInterrupted(false)

			let answer = ''

			// If no last completed node, default to the first node
			if (interviewResponse.interview && interviewResponse.interview.flow && interviewResponse.interview.flow.nodes && interviewResponse.interview.flow.nodes.length > 0 && !lastCompletedNode) {
				const startNode = interviewResponse.interview.flow.nodes.find(node => node.data && node.data.type === 'start')

				lastCompletedNode = startNode
			}

			logger.info(`User finished speaking: ${transcript}`)

			// check for voicemail phrases incase call made it through voicemail
			if (matchesVoicemailPhrase(transcript)) {
				logger.debug('Detected voicemail phrase, ending the call.')
				await _onHangup()
				return
			}

			interviewResponse.conversation_history.push({
				date: new Date(),
				author,
				text: transcript,
			})

			let didClearFillerSound = false

			if (presenceInterimAudio) {
				callMediaQueue.playInterimAudio()
			} else {
				didClearFillerSound = true
			}

			const audioChunks: Buffer[] = []
			let aiResponse = ''

			logger.debug(`Time to get prompt: ${new Date().getTime() - startDate}ms`)

			const shouldUsePinecone = pineconeIndex && interviewResponse.conversation_history.length > 2

			const idleTimeoutDuration = 30000
			let idleTimeout

			const resetIdleTimeout = () => {
				clearTimeout(idleTimeout)
				idleTimeout = setTimeout(() => {
					if (elevenLabsSocket.readyState === WebSocket.OPEN) {
						elevenLabsSocket.close()
						logger.warn('WebSocket closed due to inactivity.')
					}
				}, idleTimeoutDuration)
			}

			const [
				elevenLabsSocket,
				vectorResponse,
			] = await Promise.all([
				ElevenLabs.getElevenLabsWebSocket({
					outputFormat: 'ulaw_8000',
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
						resetIdleTimeout()

						if (response.audio) {
							logger.debug(`Time to get ElevenLabs audio response (#${audioChunks.length + 1}): ` +
								`${new Date().getTime() - startDate}ms`)

							setAgentSpeaking(true)

							if (!didClearFillerSound) {
								didClearFillerSound = true
								callMediaQueue.clear()
							}

							if (shouldContinueWithCompletion(dateUserStartedSpeaking)) {
								const currentChunkId = chunkSequence++
								if (response.normalizedAlignment && Array.isArray(response.normalizedAlignment.chars)) {
									textChunk = response.normalizedAlignment.chars.join('')
									audioChunkMap.set(currentChunkId, textChunk)
								}

								callMediaQueue.media(response.audio)
								callMediaQueue.mark(`audioChunkPlayed-${currentChunkId}`)
							} else {
								logger.debug('Transcription stopped, stopping audio')
								elevenLabsSocket.send(JSON.stringify({ text: '' }))
							}
						} else {
							logger.warn(`Received unknown ElevenLabs response: ${JSON.stringify(response, null, 2)}`)
						}

						if (response.isFinal && shouldContinueWithCompletion(dateUserStartedSpeaking)) {
							logger.debug(`Time to get ElevenLabs final response: ${new Date().getTime() - startDate}ms, sending mark`)
							callMediaQueue.mark(`playback_complete:${dateUserStartedSpeaking.getTime()}}`)
						}
					},
				}),
				shouldUsePinecone && queryPinecone(
					getMessagesForPineconeQuery(interviewResponse.conversation_history),
					pineconeIndex,
					4,
				),
			])

			logger.debug(`Time to get ElevenLabs socket and Pinecone vector response: ${new Date().getTime() - startDate}ms`)

			// Generate the answer for the last node based on the user's response if it's not an API call
			if (lastCompletedNode && lastCompletedNode.id && String(lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				// LLM call to get the answer
				answer = await getDataPointsForNode({
					node: lastCompletedNode,
					userAnswer: transcript,
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
					userAnswer: transcript,
					secondaryActionOutputs,
					interviewId: interviewResponse.interview.id,
					responseId: interviewResponse.id,
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			// Construct the mermaid graph with updated values held in the value tracker
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
				safetyPromise,
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

			// Helper function to stream chunks to ElevenLabs
			const streamElevenLabsChunk = (chunk: string) => {
				if (!shouldContinueWithCompletion(dateUserStartedSpeaking)) {
					logger.info('Transcription stopped, stopping completion')
					elevenLabsSocket.send(JSON.stringify({ text: '' }))
					return
				}
				if (!openAIResponseTime) {
					openAIResponseTime = new Date().getTime()
				}
				elevenLabsSocket.send(JSON.stringify({ text: chunk, try_trigger_generation: true }))
				aiResponse += chunk
			}

			for await (const text of completion) {
				streamElevenLabsChunk(text)
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
						call_sid: callSid,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: userToOpenAILatency,
						team_id: interviewResponse.team_id,
					},
				})

				analytics.track({
					userId: 'system',
					event: 'OpenAI to Eleven Labs Send Latency',
					properties: {
						distinct_id: interviewResponse.id,
						call_sid: callSid,
						interview_response_id: interviewResponse.id,
						interview_id: interviewResponse.interview.id,
						latency: openAIToElevenLabsLatency,
						team_id: interviewResponse.team_id,
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
			if (!lastCompletedNode.data.times_visited) {
				lastCompletedNode.data.times_visited = 0
			}
			lastCompletedNode.data.times_visited++

			const result = await handleCompletionDataResponse({
				matchingNode,
			})

			if (typeof result === 'object' && '_shouldEndCall' in result) {
				const { _shouldEndCall, _shouldTransferCallTo, _actionDetail, _shouldTransferAgentTo } = result
				shouldEndCall = _shouldEndCall
				shouldTransferCallTo = _shouldTransferCallTo
				shouldTransferAgentTo = _shouldTransferAgentTo
				actionDetail = _actionDetail
			}

			if (!shouldContinueWithCompletion(dateUserStartedSpeaking)) {
				logger.debug('Transcription stopped, stopping completion after data promise')
				return
			}
			completionData = {
				action_detail: actionDetail,
				node_id: matchingNode.id || lastCompletedNode.id,
			}

			if (interviewResponse) {
				await interviewResponse.save()

				if (interviewResponse.job) {
					interviewResponse.job.appendLog(`[${phoneNumberTo}]: User | ${transcript}`)
					interviewResponse.job.appendLog(`[${phoneNumberTo}]: AI | ${aiResponse}`)
				}
			}

			const safetyViolation = await safetyPromise

			if (safetyViolation) {
				interviewResponse.status = InterviewResponseStatus.VIOLATION
				logger.debug('Detected dangerous phrase, ending the call.')
				await interviewResponse.save()
				await _onHangup()
			}
		} catch (error) {
			captureError(error)
		}
	}

	const _onStartTranscribing = () => {
		logger.debug('Starting transcription')
		isTranscribing = true
		lastTranscriptChangeTime = new Date().getTime()
		lastTimeUserStartedSpeaking = new Date()
		elevenLabsText = ''
		audioChunkMap.clear()
		chunkSequence = 0
	}

	const _onHangup = async () => {
		didSystemInitiateHangup = true

		if (interviewResponse.type === InterviewResponseType.AGENT_TRANSFER) {
			await withExponentialBackoff(async () => await twilioClientWithArgs({
				accountSid: process.env.TWILIO_ACCOUNT_SID,
			}).calls(callSid).update({ status: 'completed' }))
		} else {
			await withExponentialBackoff(async () => await twilioClientWithArgs({
				accountSid: accountSid,
			}).calls(callSid).update({ status: 'completed' }))
		}
	}

	// This will allow the event loop to process any pending operations
	// in between sending individual audio packets, which should mitigate
	// potential event loop blocking, even if the queue size is large.
	// However, as always, be cautious and monitor the queue size to prevent memory issues.
	const sendQueueForTranscriptionService = () => {
		if (audioQueue.length > 0) {
			const packet = audioQueue.shift()
			transcriptionStream.send(packet)
			setImmediate(sendQueueForTranscriptionService)
		}
	}

	const queueForTranscriptionService = (data: any) => {
		if (audioQueue.length > audioQueueMaxSize) {
			logger.error(`addQueuedAudio() queue is full, dropping audio packet ${audioQueue.length}`)
			return
		} else if (audioQueue.length > audioQueueWarningThreshold) {
			logger.warn(`addQueuedAudio() ${audioQueue.length}`)
		}

		audioQueue.push(data)
	}

	const sendToTranscriptionService = (data: any) => {
		if (transcriptionStream && transcriptionStream.getReadyState() === ConnectionState.OPEN) {
			transcriptionStream.send(data)
		} else {
			logger.debug('Buffering data due to closed Deepgram socket')
			queueForTranscriptionService(data)
		}
	}

	const _onInterimTranscript = async (data: LiveTranscriptionResponse) => {
		try {
			const transcript = data.channel.alternatives[0].transcript
			const newTranscript = `${interimTranscript} ${transcript}`.trim()

			if (newTranscript.trim().length === 0) {
				return
			}

			if (!isTranscribing) {
				const numAgentMessages = interviewResponse.conversation_history.filter(
					(message) => message.author === 'ai'
				).length

				if (numAgentMessages === 1) {
					// Don't interrupt if the agent has only sent one message
					return
				}

				if (isUserWordIgnorable(transcript.toLowerCase())) {
					logger.info(`Ignoring interjection from user: ${transcript}`)
					return
				}

				setUserInterrupted(true)

				logger.info(`User interrupted agent: ${transcript}`)

				_onStartTranscribing()

				callMediaQueue.clear()
			}

			logger.info(`Received transcript: ${transcript}`)

			const isFullTranscriptEmpty = newTranscript.length === 0

			if (transcript.trim().length !== 0) {
				lastTranscriptChangeTime = new Date().getTime()
			}

			// Update interim transcript only if there's a change
			if (data.is_final && transcript) {
				interimTranscript = newTranscript
				logger.info(`Interim transcript updated: ${newTranscript}`)
			}

			if (transcript) {
				if (remainingAgentTryLimit !== agentTryLimit) {
					logger.info(`User started speaking, clearing silence timeout and resetting agent speak count to ${agentTryLimit}`)
					remainingAgentTryLimit = agentTryLimit
				}
				isRepeating = false
				clearSilenceTimeout()
			}

			if (
				data.speech_final &&
				!isFullTranscriptEmpty
			) {
				logger.info('Ending transcription: speech_final')
				return _onFinishTalking(newTranscript, lastTimeUserStartedSpeaking)
			}

			// Check for silence duration
			const currentSilenceDuration = new Date().getTime() - lastTranscriptChangeTime
			const silenceThreshold = 250 // 3 seconds of silence

			if (currentSilenceDuration > silenceThreshold && !isFullTranscriptEmpty) {
				logger.info(`Ending transcription: silence for ${currentSilenceDuration} ms`)
				return _onFinishTalking(interimTranscript, lastTimeUserStartedSpeaking)
			}

			// Check for overall timeout
			if (currentSilenceDuration > 250) {
				logger.info('Ending transcription: timeout')
				return _onFinishTalking(interimTranscript, lastTimeUserStartedSpeaking)
			}
		} catch (error) {
			captureError(error)
		}
	}

	const _initTranscriptionStream = () => {
		transcriptionStream = getDeepgram().transcription.live({
			smart_format: false,
			interim_results: true,
			language: lang,
			model: getModelByLanguage(InterviewLanguage[lang]),
			endpointing: 50,
			filler_words: true,
			encoding: 'mulaw',
			sample_rate: 8000,
			// https://developers.deepgram.com/docs/keywords
			keywords: [
				'Thoughtly',
			],
		})
			.addListener('transcriptReceived', (message) => {
				const data = JSON.parse(message)
				if (data.type === 'Results') {
					_onInterimTranscript(data)
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

				// if we reconnected then send our audio queue
				sendQueueForTranscriptionService()

				createInterruptableWordsForLanguage(InterviewLanguage[lang])
			})
			.addListener('error', (error) => {
				captureError(error)
			})
	}

	socket.on('message', async (message) => {
		const data = JSON.parse(message.toString())

		switch (data.event) {
			case 'connected': {
				logger.info('[Twilio] New call connected')
				break
			}
			case 'start': {
				try {
					logger.info('[Twilio] New call started')
					streamSid = data.start.streamSid
					callSid = data.start.callSid
					accountSid = data.start.accountSid

					const customParameters = JSON.parse(data.start.customParameters?.Data)

					phoneNumberTo = customParameters.to
					phoneNumberFrom = customParameters.from
					interviewResponseId = customParameters.interview_response_id
					answeredBy = customParameters.answered_by

					if (interviewResponseId) {
						logger.info(`Inbound call socket from ${phoneNumberFrom} to ${phoneNumberTo} | ` +
							`Interview response ID: ${interviewResponseId}`)

						interviewResponse = await InterviewResponseEntity.findOneOrFail({
							where: {
								id: interviewResponseId,
							},
							relations: ['job', 'interview', 'team', 'interview.flow'],
						})
					} else {
						interviewResponse = await InterviewResponseEntity.findOneOrFail({
							where: {
								twilio_sid: data.start.callSid,
							},
							relations: ['job', 'interview', 'team', 'interview.flow'],
						})
					}

					presenceInterimAudio = interviewResponse.interview.presence_interim_audio !== null
					logger.debug(`Presence interim audio enabled: ${presenceInterimAudio}, presence_interim_audio=${interviewResponse.interview.presence_interim_audio}`)

					callMediaQueue = new CallMediaQueue({
						streamSid: streamSid,
						socket: socket,
						backgroundTrackName: interviewResponse.interview.presence_background_audio,
						interimTrackName: presenceInterimAudio ? interviewResponse.interview.presence_interim_audio.toLocaleLowerCase() : 'none',
					})

					logger.info({
						message: '[Twilio] New call started',
						streamSid,
						callSid,
						accountSid,
						interviewResponseId,
					})

					if (answeredBy === 'not-human') {
						// set the agent speak count to 3 if twilio dont recognize human
						agentTryLimit = 3
						remainingAgentTryLimit = 3
					}

					try {
						analytics.track({
							userId: 'system',
							event: 'Call Connected',
							properties: {
								distinct_id: interviewResponse.id,
								call_sid: callSid,
								interview_response_id: interviewResponse.id,
								interview_id: interviewResponse.interview.id,
								phone_number_from: phoneNumberFrom,
								phone_number_to: phoneNumberTo,
								team_id: interviewResponse.team_id,
							},
						})
					} catch (error) {
						logger.error({
							message: 'Failed during call connecting',
							error: error.message,
							interviewResponseId,
						})
						captureError(error)
					}

					lang = interviewResponse.interview.lang

					_initTranscriptionStream()

					const greetingUrl = interviewResponse.conversation_history[
						interviewResponse.conversation_history.length - 1
					].audio_url

					if (!greetingUrl) {
						throw new Error('No greeting URL found')
					}

					downloadFileStream(greetingUrl)
						.then((stream) => {
							stream.on('data', (chunk) => {
								callMediaQueue.media(chunk.toString('base64'))
							})
							stream.on('end', () => {
								logger.debug('Greeting audio playback complete, sending mark')
								callMediaQueue.mark('playback_complete')
							})
						})
						.catch((error) => {
							logger.error({
								message: 'Failed during playback_complete',
								error: error.message,
								interviewResponseId,
							})
							captureError(error)
						})

					// record only if it is enabled
					if (interviewResponse.interview.should_record) {
						if (interviewResponse.type === InterviewResponseType.AGENT_TRANSFER) {
							await withExponentialBackoff(async () => await twilioClientWithArgs({
								accountSid: process.env.TWILIO_ACCOUNT_SID,
							}).calls(data.start.callSid).recordings.create({
								trim: 'trim-silence',
								recordingChannels: 'mono',
								recordingTrack: 'both',
								recordingStatusCallback: `https://${process.env.API_URL}/webhook/twilio/recording`,
								recordingStatusCallbackEvent: ['in-progress', 'completed'],
							}))
						} else {
							await withExponentialBackoff(async () => await twilioClientWithArgs({
								accountSid: accountSid,
							}).calls(data.start.callSid).recordings.create({
								trim: 'trim-silence',
								recordingChannels: 'mono',
								recordingTrack: 'both',
								recordingStatusCallback: `https://${process.env.API_URL}/webhook/twilio/recording`,
								recordingStatusCallbackEvent: ['in-progress', 'completed'],
							}))
						}
					}

					if (interviewResponse.job) {
						await interviewResponse.job.appendLog(
							`[${phoneNumberTo}]: Picked up, started recording`
						)
					}

					interviewResponse.status = InterviewResponseStatus.IN_PROGRESS
					await interviewResponse.save()

					if (interviewResponse.interview.genius_id) {
						logger.info(`Getting Pinecone index for genius ${interviewResponse.interview.genius_id}`)
						pineconeIndex = getPineconeIndex(interviewResponse.interview.genius_id)
					}
				} catch (error) {
					logger.error({
						message: 'Failed during hangup',
						error: error.message,
						interviewResponseId,
					})
					captureError(error)
					return _onHangup()
				}

				break
			}
			case 'media': {
				const payload = Buffer.from(data.media.payload, 'base64')

				if (!transcriptionStream) {
					logger.error('Transcription stream not found')
					_initTranscriptionStream()
					return
				}

				sendToTranscriptionService(payload)

				break
			}
			case 'stop': {
				logger.info('[Twilio] Call stopped', interviewResponseId)
				if (interviewResponse && interviewResponse.status === InterviewResponseStatus.IN_PROGRESS) {
					const wasSystemInitiatedHangup = didSystemInitiateHangup || shouldEndCall || shouldTransferCallTo !== null
					await onInterviewEnd(interviewResponse, callSid, !wasSystemInitiatedHangup)
					if (interviewResponse.job) {
						await interviewResponse.job.appendLog(`[${phoneNumberTo}]: Call completed`)
					}
				}

				transcriptionStream?.send(JSON.stringify({
					type: 'CloseStream',
				}))

				callMediaQueue?.stopBackgroundAudio()

				clearSilenceTimeout()

				break
			}
			case 'mark': {
				try {
					logger.info(`[Twilio] Mark: ${data.mark.name}`)

					const markerParts = data.mark.name.split('-')
					if (markerParts[0] === 'audioChunkPlayed') {
						const chunkId = parseInt(markerParts[1], 10)
						if (audioChunkMap.has(chunkId)) {
							elevenLabsText += audioChunkMap.get(chunkId)
							if (isNewAISpeechSegment) {
								interviewResponse.conversation_history.push({
									date: new Date(),
									author: 'ai',
									text: elevenLabsText,
									completion_data: completionData,
								})
								isNewAISpeechSegment = false
							} else {
								const lastEntry = interviewResponse.conversation_history[interviewResponse.conversation_history.length - 1]
								if (lastEntry && lastEntry.author === 'ai') {
									lastEntry.text = elevenLabsText
									lastEntry.completion_data = completionData
								}
							}

							audioChunkMap.delete(chunkId)
						}
					}

					if (data.mark.name.startsWith('playback_complete')) {
						setAgentSpeaking(false)

						const date = new Date(parseInt(data.mark.name.split(':')[1]))

						if (!shouldEndCall && !shouldTransferCallTo && !shouldTransferAgentTo) {
							// ai response completed, start silence timeout
							logger.info('Agent finished speaking, starting silence timeout')
							await startSilenceTimeout()
						}

						_onStartTranscribing()

						if (!shouldContinueWithCompletion(date) && !shouldEndCall && !shouldTransferCallTo && !shouldTransferAgentTo) {
							logger.debug('Transcription stopped, stopping at mark')
							return
						}

						if (shouldTransferAgentTo) {
							const redisBody = {
								interview_response_id: interviewResponse.id,
								new_interview_id: shouldTransferAgentTo,
								old_call_sid: callSid,
							}

							const existingTransfer = await redisRead(`agent-transfer-interview-${interviewResponse.phone_number}`)
							if (existingTransfer) {
								await redisDelete(`agent-transfer-interview-${interviewResponse.phone_number}`)
							}
							await redisWrite(
								`agent-transfer-interview-${interviewResponse.phone_number}`,
								JSON.stringify(redisBody),
								{
									EX: 60,
								}
							)

							clearSilenceTimeout()
							const twiml = new VoiceResponse()
							const dial = twiml.dial({
								callerId: interviewResponse.phone_number,
							})
							await withExponentialBackoff(async () => {
								dial.number({
									statusCallback: `https://${process.env.API_URL}/webhook/twilio/transfer/status`,
									statusCallbackMethod: 'POST',
									statusCallbackEvent: ['ringing'],
								}, process.env.OUTBOUND_PHONE_NUMBER)
							}).catch(error => {
								captureError(error)
							})

							socket.send(
								JSON.stringify({
									event: 'stop',
									streamSid: streamSid,
								})
							)

							if (interviewResponse.type === InterviewResponseType.AGENT_TRANSFER) {
								await twilioClientWithArgs({
									accountSid: process.env.TWILIO_ACCOUNT_SID,
								}).calls(callSid).update({ twiml: twiml.toString() })
							} else {
								await twilioClientWithArgs({
									accountSid: interviewResponse.team.twilio_account_sid,
								}).calls(callSid).update({ twiml: twiml.toString() })
							}

							const wasSystemInitiatedHangup = didSystemInitiateHangup || shouldEndCall || shouldTransferAgentTo !== null
							await onInterviewEnd(interviewResponse, callSid, !wasSystemInitiatedHangup, shouldTransferAgentTo)
						}

						if (shouldTransferCallTo && !getUserInterrupted()) {
							const data = { phone_number: interviewResponse.phone_number, transcript: formatTranscript(interviewResponse) }
							await Promise.all([
								getAndFireWebhooks(WebhookEventType.PHONE_TRANSFER, interviewResponse.interview.id, data)
									.catch(error => {
										captureError(error)
									}),
								withExponentialBackoff(async () => await twilioClientWithArgs({
									accountSid,
								}).calls(callSid).update({
									twiml: new VoiceResponse()
										.dial({
											callerId: interviewResponse.phone_number,
										})
										.number(
											{
												statusCallback: `https://${process.env.API_URL}/webhook/twilio/transfer/status`,
												statusCallbackMethod: 'POST',
												statusCallbackEvent: ['ringing'],
											},
											shouldTransferCallTo
										),
								})),
							])

							const wasSystemInitiatedHangup = didSystemInitiateHangup || shouldEndCall || shouldTransferCallTo !== null
							await onInterviewEnd(interviewResponse, callSid, !wasSystemInitiatedHangup, shouldTransferCallTo)
						}

						if (shouldEndCall && !getUserInterrupted()) {
							logger.info('Ending call')
							await _onHangup()
						}

						if (
							interviewResponse.conversation_history[
								interviewResponse.conversation_history.length - 1
							].text.toLowerCase().includes('goodbye') &&
							interviewResponse.conversation_history[
								interviewResponse.conversation_history.length - 1
							].author === 'ai'
						) {
							await _onHangup()
						}
					}

					await interviewResponse.save()
				} catch (error) {
					captureError(error)
				}
			}
		}
	})
}

export default onTwilioSocket
