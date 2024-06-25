/* eslint-disable max-len */
import { LiveTranscription } from '@deepgram/sdk/dist/transcription/liveTranscription'
import logger from '../../../util/logger.util'
import { getDeepgram, getModelByLanguage } from '../../../services/deepgram'
import { captureError } from '../../../util/error.util'
import { WebSocket } from 'ws'
import { InterviewResponseStatus, InterviewResponseType } from '../../interview-response/db/interview-response.types'
import { LiveTranscriptionResponse } from '@deepgram/sdk/dist/types'
import { masterTwilioClient, twilioClientWithArgs } from '../../../services/twilio'
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
import * as VoiceResponse from 'twilio/lib/twiml/VoiceResponse'
import { matchesVoicemailPhrase } from './call.helpers'
import { InterviewFunctionName, InterviewNode } from '../../../modules/interview-flow/db/interview-flow.types'
import { DataPointEntity } from '../../../modules/data-point/db/data-point.entity'
import { DataPointType } from '../../../modules/data-point/db/data-point.types'
import { DataPointValueType } from '../../../modules/data-point/db/data-point.types'
import { usei18n, translate } from '../../../services/i18n'
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

enum ConnectionState {
	CONNECTING = 0,
	OPEN = 1,
	CLOSING = 2,
	CLOSED = 3
}

class VirtualAgent {

	private twilioSocket: WebSocket = null
	private ignoreInterruptWords: Set<string> = new Set<string>()

	// Twilio call data
	private streamSid: string = ''
	private phoneNumberTo: string = ''
	private phoneNumberFrom: string = ''
	private interviewResponseId: string = ''
	private callSid: string = ''
	private accountSid: string = ''

	// Transcription variables
	private lastTranscriptChangeTime: number = new Date().getTime()
	private transcriptionStream: LiveTranscription | null = null
	private isTranscribing: boolean = false
	private interimTranscript: string = ''
	private interimAnalysis: any = null

	// Interview variables
	private interviewResponse: InterviewResponseEntity | null = null
	private lang: string = 'en'

	// Pinecone variables
	private pineconeIndex: Index | null = null

	// Call variables
	private shouldEndCall: boolean = false
	private shouldTransferCallTo: string = null
	private shouldTransferAgentTo: string = null
	private actionDetail: any = null
	private lastTimeUserStartedSpeaking: Date = null
	private didSystemInitiateHangup: boolean = false
	private callMediaQueue: CallMediaQueue = null
	private lastUserStopTalkingTime: number = 0
	private isRepeating: boolean = true
	private answeredBy: string = 'human'

	// ElevenLabs variables
	private openAIResponseTime: number = 0
	private elevenLabsSendTime: number = 0
	private elevenLabsConnectionRetries: number = 0
	private presenceInterimAudio: boolean = false
	private elevenLabsText: string = ''
	private chunkSequence: number = 0
	private audioChunkMap: Map<number, string> = new Map()
	private completionData: any = null
	private isNewAISpeechSegment: boolean = true
	private textChunk: string
	private userInterrupted: boolean = false
	private agentTryLimit: number = 5
	private remainingAgentTryLimit: number = this.agentTryLimit
	private agentSpeakingState: boolean = false
	private agentSpeakingStartTime: number = 0
	private blankValueTracker: { nodeId: string; value: string }[] = []
	private lastCompletedNode: InterviewNode
	private secondaryActionOutputs: any[] = []

	// Deepgram audio queue while disconnected
	private audioQueue: any[] = []
	// Deepgram audio queue settings
	private audioQueueMaxSize: number = 2000
	private audioQueueWarningThreshold: number = 400

	private silenceTimeoutDuration: number = 3000 // 3 seconds
	private silenceTimeout: NodeJS.Timeout = null

	constructor(socket: WebSocket) {
		logger.info('Virtual agent created')
		this.initializeTwilioSocket(socket)
	}

	private initializeTwilioSocket(socket: WebSocket) {
		this.twilioSocket = socket
		this.twilioSocket.on('message', this.handleTwilioMessage.bind(this))
	}

	private assignTwilioCallVariables(data: any) {
		this.streamSid = data.start.streamSid
		this.callSid = data.start.callSid
		this.accountSid = data.start.accountSid
		const customParameters = JSON.parse(data.start.customParameters?.Data)
		this.phoneNumberTo = customParameters.to
		this.phoneNumberFrom = customParameters.from
		this.interviewResponseId = customParameters.interview_response_id
		this.answeredBy = customParameters.answered_by
	}

	private async handleTwilioMessage(message: any) {
		try {
			const data = JSON.parse(message.toString())
			switch (data.event) {
				case 'connected':
					this.handleTwilioConnected(data)
					break
				case 'start':
					this.handleTwilioStart(data)
					break
				case 'media':
					this.handleTwilioMedia(data)
					break
				case 'stop':
					this.handleTwilioStop(data)
					break
				case 'mark':
					this.handleTwilioMark(data)
					break
				default:
					logger.error('Unknown Twilio message event: ', data.event)
			}
		} catch (error) {
			logger.error('Error parsing Twilio message', error)
		}
	}

	private async handleTwilioConnected(data: any) {
		logger.info('[Twilio] Call connected')
	}

	private async handleTwilioStart(data: any) {
		try {
			logger.info('[Twilio] Call started')
			this.assignTwilioCallVariables(data)
			if (this.interviewResponseId) {
				logger.info(`Inbound call socket from ${this.phoneNumberFrom} to ${this.phoneNumberTo} | Interview response ID: ${this.interviewResponseId}`)
				this.interviewResponse = await InterviewResponseEntity.findOneOrFail({
					where: { id: this.interviewResponseId },
					relations: ['job', 'interview', 'team', 'interview.flow'],
				})
			} else {
				this.interviewResponse = await InterviewResponseEntity.findOneOrFail({
					where: { twilio_sid: data.start.callSid },
					relations: ['job', 'interview', 'team', 'interview.flow'],
				})
			}
			logger.info({
				message: '[Twilio] Call started with info',
				streamSid: this.streamSid,
				callSid: this.callSid,
				accountSid: this.accountSid,
				interviewResponseId: this.interviewResponseId,
			})
			this.presenceInterimAudio = this.interviewResponse.interview.presence_interim_audio !== null
			logger.debug(`Presence interim audio enabled: ${this.presenceInterimAudio}, presence_interim_audio=${this.interviewResponse.interview.presence_interim_audio}`)
			this.callMediaQueue = new CallMediaQueue({
				streamSid: this.streamSid,
				socket: this.twilioSocket,
				backgroundTrackName: this.interviewResponse.interview.presence_background_audio,
				interimTrackName: this.presenceInterimAudio ? this.interviewResponse.interview.presence_interim_audio.toLocaleLowerCase() : 'none',
			})
			if (this.answeredBy === 'not-human') {
				this.agentTryLimit = 3
				this.remainingAgentTryLimit = 3
			}
			this.lang = this.interviewResponse.interview.lang
			this.initTranscriptionStream()
			const greetingUrl = this.interviewResponse.conversation_history[this.interviewResponse.conversation_history.length - 1].audio_url
			if (!greetingUrl) {
				throw new Error('No greeting URL found')
			}
			downloadFileStream(greetingUrl)
				.then((stream) => {
					stream.on('data', (chunk) => {
						this.callMediaQueue.media(chunk.toString('base64'))
					})
					stream.on('end', () => {
						logger.debug('Greeting audio playback complete, sending mark')
						this.callMediaQueue.mark('playback_complete')
					})
				})
				.catch((error) => {
					logger.error({
						message: 'Failed during playback_complete',
						error: error.message,
						interviewResponseId: this.interviewResponseId,
					})
					captureError(error)
				})

			if (this.interviewResponse.interview.should_record) {
				const accountSid = this.interviewResponse.type === InterviewResponseType.AGENT_TRANSFER
					? process.env.TWILIO_ACCOUNT_SID
					: this.accountSid
				await withExponentialBackoff(async () => twilioClientWithArgs({ accountSid }).calls(this.callSid).recordings.create({
					trim: 'trim-silence',
					recordingChannels: 'mono',
					recordingTrack: 'both',
					recordingStatusCallback: `https://${process.env.API_URL}/webhook/twilio/recording`,
					recordingStatusCallbackEvent: ['in-progress', 'completed'],
				})).catch(captureError)
			}

			if (this.interviewResponse.job) {
				await this.interviewResponse.job.appendLog(`[${this.phoneNumberTo}]: Picked up, started recording`)
			}
			this.interviewResponse.status = InterviewResponseStatus.IN_PROGRESS
			await this.interviewResponse.save()
			if (this.interviewResponse.interview.genius_id) {
				logger.info(`Getting Pinecone index for genius ${this.interviewResponse.interview.genius_id}`)
				this.pineconeIndex = getPineconeIndex(this.interviewResponse.interview.genius_id)
			}
		} catch (error) {
			logger.error({
				message: 'Failed during hangup',
				error: error.message,
				interviewResponseId: this.interviewResponseId,
			})
			captureError(error)
			return this.onHangup('Error initializing call')
		}
	}

	private async handleTwilioMedia(data: any) {
		const payload = Buffer.from(data.media.payload, 'base64')
		if (!this.transcriptionStream) {
			logger.error('Transcription stream not found')
			this.initTranscriptionStream()
			return
		}
		this.sendToTranscriptionService(payload)
	}

	private async handleTwilioStop(data: any) {
		logger.info(`Ending call (${this.interviewResponseId}): call stopped by Twilio`)
		if (this.interviewResponse && this.interviewResponse.status === InterviewResponseStatus.IN_PROGRESS) {
			const wasSystemInitiatedHangup = this.didSystemInitiateHangup || this.shouldEndCall || this.shouldTransferCallTo !== null
			await onInterviewEnd(this.interviewResponse, this.callSid, !wasSystemInitiatedHangup)
			if (this.interviewResponse.job) {
				await this.interviewResponse.job.appendLog(`[${this.phoneNumberTo}]: Call completed`)
			}
		}
		this.transcriptionStream?.send(JSON.stringify({ type: 'CloseStream' }))
		this.callMediaQueue?.stopBackgroundAudio()
		this.clearSilenceTimeout()
	}

	private async handleTwilioMark(data: any) {
		try {
			logger.info(`[Twilio] Mark: ${data.mark.name}`)
			const markerParts = data.mark.name.split('-')

			if (markerParts[0] === 'audioChunkPlayed') {
				const chunkId = parseInt(markerParts[1], 10)
				if (this.audioChunkMap.has(chunkId)) {
					this.elevenLabsText += this.audioChunkMap.get(chunkId)
					if (this.isNewAISpeechSegment) {
						this.interviewResponse.conversation_history.push({
							date: new Date(),
							author: 'ai',
							text: this.elevenLabsText,
							completion_data: this.completionData,
						})
						this.isNewAISpeechSegment = false
					} else {
						const lastEntry = this.interviewResponse.conversation_history[this.interviewResponse.conversation_history.length - 1]
						if (lastEntry && lastEntry.author === 'ai') {
							lastEntry.text = this.elevenLabsText
							lastEntry.completion_data = this.completionData
						}
					}
					this.audioChunkMap.delete(chunkId)
				}
			}

			if (data.mark.name.startsWith('playback_complete')) {
				this.setAgentSpeaking(false)
				const date = new Date(parseInt(data.mark.name.split(':')[1]))
				if (!this.shouldEndCall && !this.shouldTransferCallTo && !this.shouldTransferAgentTo) {
					logger.info('Agent finished speaking, starting silence timeout')
					await this.startSilenceTimeout()
				}
				this.onStartTranscribing()
				if (!this.shouldContinueWithCompletion(date) && !this.shouldEndCall && !this.shouldTransferCallTo && !this.shouldTransferAgentTo) {
					logger.debug('Transcription stopped, stopping at mark')
					return
				}

				if (this.shouldTransferAgentTo) {
					const redisBody = {
						interview_response_id: this.interviewResponse.id,
						new_interview_id: this.shouldTransferAgentTo,
						old_call_sid: this.callSid,
					}
					await this.handleAgentTransfer(redisBody)
					return // exit as handling transfer involves ending current flow
				}

				if (this.shouldTransferCallTo && !this.getUserInterrupted()) {
					const data = { phone_number: this.interviewResponse.phone_number, transcript: formatTranscript(this.interviewResponse) }
					await Promise.all([
						getAndFireWebhooks(WebhookEventType.PHONE_TRANSFER, this.interviewResponse.interview.id, data).catch(captureError),
						withExponentialBackoff(async () => {
							await twilioClientWithArgs({ accountSid: this.accountSid }).calls(this.callSid).update({
								twiml: new VoiceResponse().dial({ callerId: this.interviewResponse.phone_number }).number({
									statusCallback: `https://${process.env.API_URL}/webhook/twilio/transfer/status`,
									statusCallbackMethod: 'POST',
									statusCallbackEvent: ['ringing'],
								}, this.shouldTransferCallTo),
							})
						}),
					])
					const wasSystemInitiatedHangup = this.didSystemInitiateHangup || this.shouldEndCall || this.shouldTransferCallTo !== null
					await onInterviewEnd(this.interviewResponse, this.callSid, !wasSystemInitiatedHangup, this.shouldTransferCallTo)
				}

				if (this.shouldEndCall && !this.getUserInterrupted()) {
					logger.info('Agent initiated hangup')
					// await this.onHangup('Mark: playback_complete, this.shouldEndCall is true')
				}

				if (
					this.interviewResponse.conversation_history[this.interviewResponse.conversation_history.length - 1].text.toLowerCase().includes('goodbye') &&
					this.interviewResponse.conversation_history[this.interviewResponse.conversation_history.length - 1].author === 'ai'
				) {
					await this.onHangup('Mark: playback_complete, AI said goodbye')
				}
			}

			await this.interviewResponse.save()
		} catch (error) {
			captureError(error)
		}
	}

	private async handleAgentTransfer(redisBody: any) {
		const existingTransfer = await redisRead(`agent-transfer-interview-${this.interviewResponse.phone_number}`)
		if (existingTransfer) {
			await redisDelete(`agent-transfer-interview-${this.interviewResponse.phone_number}`)
		}
		await redisWrite(
			`agent-transfer-interview-${this.interviewResponse.phone_number}`,
			JSON.stringify(redisBody),
			{
				EX: 60,
			}
		)

		this.clearSilenceTimeout()
		if (this.interviewResponse.type === InterviewResponseType.AGENT_TRANSFER) {
			withExponentialBackoff(async () => {
				await masterTwilioClient().calls(this.callSid).update({
					twiml: new VoiceResponse().dial({ callerId: this.interviewResponse.phone_number }).number({
						statusCallback: `https://${process.env.API_URL}/webhook/twilio/transfer/status`,
						statusCallbackMethod: 'POST',
						statusCallbackEvent: ['ringing'],
					}, process.env.OUTBOUND_PHONE_NUMBER),
				})
			})
		} else {
			withExponentialBackoff(async () => {
				await twilioClientWithArgs({ accountSid: this.accountSid }).calls(this.callSid).update({
					twiml: new VoiceResponse().dial({ callerId: this.interviewResponse.phone_number }).number({
						statusCallback: `https://${process.env.API_URL}/webhook/twilio/transfer/status`,
						statusCallbackMethod: 'POST',
						statusCallbackEvent: ['ringing'],
					}, process.env.OUTBOUND_PHONE_NUMBER),
				})
			})
		}

		const wasSystemInitiatedHangup = this.didSystemInitiateHangup || this.shouldEndCall || this.shouldTransferAgentTo !== null
		await onInterviewEnd(this.interviewResponse, this.callSid, !wasSystemInitiatedHangup, this.shouldTransferAgentTo)
	}

	private shouldContinueWithCompletion(dateUserStartedSpeaking: Date) {
		return (!this.isTranscribing && dateUserStartedSpeaking === this.lastTimeUserStartedSpeaking) || this.isRepeating
	}

	private createInterruptableWordsForLanguage(lang: InterviewLanguage): void {
		const translated = new Set<string>()
		usei18n()
		for (const word of kIgnoreInterruptWordsInEnglish) {
			const translatedWord = translate(word, null, { lang: lang })
			translated.add(translatedWord)
		}
		logger.info(`Ignorable interrupt words for ${lang}: ${Array.from(translated).join(', ')}`)
		this.ignoreInterruptWords = translated
	}

	private isUserWordIgnorable(word: string): boolean {
		return word && this.ignoreInterruptWords.has(word.toLowerCase())
	}

	private clearSilenceTimeout(): void {
		if (this.silenceTimeout) {
			clearTimeout(this.silenceTimeout)
			this.silenceTimeout = null
			logger.debug('Cleared silence timeout')
		}
	}

	private isAgentSpeaking(): boolean {
		logger.info(`Agent speaking: ${this.agentSpeakingState}`)
		return this.agentSpeakingState
	}

	private setAgentSpeaking(value: boolean): void {
		if (this.agentSpeakingState !== value) {
			this.agentSpeakingState = value
			if (value) {
				this.agentSpeakingStartTime = performance.now()
				logger.info('Agent started speaking')
			} else {
				const agentSpeakingDuration = (performance.now() - this.agentSpeakingStartTime) / 1000
				logger.info(`Agent spoke for ${agentSpeakingDuration} sec`)
			}
		}
	}

	private getUserInterrupted(): boolean {
		logger.debug(`User interrupted value: ${this.userInterrupted}`)
		return this.userInterrupted
	}

	private setUserInterrupted(value: boolean): void {
		if (this.userInterrupted !== value) {
			this.userInterrupted = value
			logger.info(`User interrupted set to: ${value}`)
		}
	}

	private async startSilenceTimeout() {
		this.clearSilenceTimeout()
		this.remainingAgentTryLimit--

		if (this.remainingAgentTryLimit === 0) {
			// End the call if the agent tries have reached the limit
			if (this.answeredBy === 'not-human' && this.interviewResponse) {
				this.interviewResponse.status = InterviewResponseStatus.NO_ANSWER
				await this.interviewResponse.save()
			}
			logger.debug(`Agent tried initiating ${this.agentTryLimit} times, no respond from the user. Ending the call.`)
			await this.onHangup('Reached agent retry limit without user response')
			return
		}

		if (this.isAgentSpeaking()) {
			logger.debug('*** Agent is speaking, not starting silence timeout')
		} else {
			logger.info(`Agent is not speaking. Reinitiate ${this.remainingAgentTryLimit} more times`)
			this.silenceTimeout = setTimeout(() => {
				// Reinitiate the AI if the user does not speak within the timeout duration
				this.isRepeating = true
				if (this.remainingAgentTryLimit === 1) {
					this.onFinishTalking('** silence, user has not spoken in a while, say goodbye and end the call **', new Date(), 'system')
				} else {
					this.onFinishTalking('** silence, user does not speak **', new Date(), 'system')
				}
			}, this.silenceTimeoutDuration)
		}
	}

	private async onFinishTalking(transcript: string, dateUserStartedSpeaking: Date, author: 'user' | 'system' | 'ai' = 'user') {
		try {
			this.lastUserStopTalkingTime = new Date().getTime()
			const startDate = new Date().getTime()
			this.isTranscribing = false
			this.interimTranscript = ''
			this.isNewAISpeechSegment = true
			this.setUserInterrupted(false)
			let answer = ''
			this.elevenLabsConnectionRetries = 0

			if (this.interviewResponse.interview && this.interviewResponse.interview.flow && this.interviewResponse.interview.flow.nodes &&
				this.interviewResponse.interview.flow.nodes.length > 0 && !this.lastCompletedNode) {
				this.lastCompletedNode = this.interviewResponse.interview.flow.nodes[0]
			}
			logger.info(`User finished speaking: ${transcript}`)

			if (matchesVoicemailPhrase(transcript)) {
				logger.debug('Detected voicemail phrase, ending the call.')
				await this.onHangup('Detected voicemail phrase')
				return
			}

			this.interviewResponse.conversation_history.push({
				date: new Date(),
				author,
				text: transcript,
			})

			let didClearFillerSound = false
			if (this.presenceInterimAudio) {
				this.callMediaQueue.playInterimAudio()
			} else {
				didClearFillerSound = true
			}
			const audioChunks: Buffer[] = []
			let aiResponse = ''
			logger.debug(`Time to get prompt: ${new Date().getTime() - startDate}ms`)
			const shouldUsePinecone = this.pineconeIndex && this.interviewResponse.conversation_history.length > 2
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
					voiceId: voiceIdFromName(this.interviewResponse.ai_name).id,
					model: voiceModelFromLanguage(this.interviewResponse.interview.lang),
					onError: (error) => { throw error },
					onOpen: () => {
						logger.debug(`Time to open ElevenLabs socket: ${new Date().getTime() - startDate}ms`)
					},
					onMessage: async (event) => {
						const response = JSON.parse(event.data)
						resetIdleTimeout()
						if (response.audio) {
							logger.debug(`Time to get ElevenLabs audio response (#${audioChunks.length + 1}): ${new Date().getTime() - startDate}ms`)
							this.setAgentSpeaking(true)
							if (!didClearFillerSound) {
								didClearFillerSound = true
								this.callMediaQueue.clear()
							}
							if (this.shouldContinueWithCompletion(dateUserStartedSpeaking)) {
								const currentChunkId = this.chunkSequence++
								if (response.normalizedAlignment && Array.isArray(response.normalizedAlignment.chars)) {
									this.textChunk = response.normalizedAlignment.chars.join('')
									this.audioChunkMap.set(currentChunkId, this.textChunk)
								}
								this.callMediaQueue.media(response.audio)
								this.callMediaQueue.mark(`audioChunkPlayed-${currentChunkId}`)
							} else {
								logger.debug('Transcription stopped, stopping audio')
								elevenLabsSocket.send(JSON.stringify({ text: '' }))
							}
						} else {
							logger.warn(`Received unknown ElevenLabs response: ${JSON.stringify(response, null, 2)}`)
						}
						if (response.isFinal && this.shouldContinueWithCompletion(dateUserStartedSpeaking)) {
							logger.debug(`Time to get ElevenLabs final response: ${new Date().getTime() - startDate}ms, sending mark`)
							this.callMediaQueue.mark(`playback_complete:${dateUserStartedSpeaking.getTime()}}`)
						}
					},
					maxRetries: 5,
					retryDelay: 100,
					retries: this.elevenLabsConnectionRetries,
				}),
				shouldUsePinecone && queryPinecone(
					getMessagesForPineconeQuery(this.interviewResponse.conversation_history),
					this.pineconeIndex, 4
				),
			])
			logger.debug(`Time to get ElevenLabs socket and Pinecone vector response: ${new Date().getTime() - startDate}ms`)

			if (this.lastCompletedNode && this.lastCompletedNode.id && String(this.lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				answer = await getDataPointsForNode({
					node: this.lastCompletedNode,
					userAnswer: transcript,
					interviewId: this.interviewResponse.interview.id,
					responseId: this.interviewResponse.id,
				})

				DataPointEntity.create({
					response_id: this.interviewResponse.id,
					interview_id: this.interviewResponse.interview.id,
					team_id: this.interviewResponse.team.id,
					response_type: this.interviewResponse.type,
					type: DataPointType.QUESTION_NODE,
					node_id: this.lastCompletedNode.id,
					value: answer,
					value_type: this.lastCompletedNode.data.outcomes?.includes(answer) ? DataPointValueType.STRICT : DataPointValueType.OTHER,
					metadata: {
						node_data: this.lastCompletedNode.data,
					},
				}).save()

				const trackerEntry = this.blankValueTracker.find(entry => entry.nodeId === this.lastCompletedNode.id)
				if (trackerEntry) {
					trackerEntry.value = answer
				} else {
					this.blankValueTracker.push({ nodeId: this.lastCompletedNode.id, value: answer })
				}

				await handleSecondaryActions({
					nodes: this.interviewResponse.interview.flow.nodes,
					edges: this.interviewResponse.interview.flow.edges,
					contact: this.interviewResponse.contact,
					blankValueTracker: this.blankValueTracker,
					lastCompletedNode: this.lastCompletedNode,
					userAnswer: transcript,
					secondaryActionOutputs: this.secondaryActionOutputs,
					interviewId: this.interviewResponse.interview.id,
					responseId: this.interviewResponse.id,
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			const { labelToNodeIdMap, mermaidGraph } = transformScriptToMermaid({
				nodes: this.interviewResponse.interview.flow.nodes,
				edges: this.interviewResponse.interview.flow.edges,
				fn_params: transformFunctionsToParams(this.interviewResponse.interview.flow.functions),
				blankValueTracker: this.blankValueTracker,
				lang: this.interviewResponse.interview.lang,
				metadata: this.interviewResponse.metadata,
				contact: this.interviewResponse.contact,
			})
			const [
				completionPromise,
				safetyPromise,
			] = await withExponentialBackoff(
				() => chatCompletionIterator({
					messages: getMessagesForCompletion({
						vectorResponse,
						conversation_history: this.interviewResponse.conversation_history,
					}),
					timeoutMs: 5000,
					interimAnalysis: this.interimAnalysis,
					responseId: this.interviewResponse.id,
					interviewId: this.interviewResponse.interview.id,
					script: mermaidGraph,
					teamId: this.interviewResponse.team_id,
					secondaryActionOutputs: this.secondaryActionOutputs,
				})
			)
			this.interimAnalysis = null
			const completion = await completionPromise

			const streamElevenLabsChunk = (chunk: string) => {
				if (!this.shouldContinueWithCompletion(dateUserStartedSpeaking)) {
					logger.info('Transcription stopped, stopping completion')
					elevenLabsSocket.send(JSON.stringify({ text: '' }))
					return
				}
				if (!this.openAIResponseTime) {
					this.openAIResponseTime = new Date().getTime()
				}
				elevenLabsSocket.send(JSON.stringify({ text: chunk, try_trigger_generation: true }))
				aiResponse += chunk
			}

			for await (const text of completion) {
				streamElevenLabsChunk(text)
			}
			logger.debug(`Time to get AI response: ${new Date().getTime() - startDate}ms | ${aiResponse}`)
			this.elevenLabsSendTime = new Date().getTime()
			elevenLabsSocket.send(JSON.stringify({ text: '' }))

			const userToOpenAILatency = this.openAIResponseTime - this.lastUserStopTalkingTime
			const openAIToElevenLabsLatency = this.elevenLabsSendTime - this.openAIResponseTime
			try {
				analytics.track({
					userId: 'system',
					event: 'User to OpenAI Latency',
					properties: {
						distinct_id: this.interviewResponse.id,
						call_sid: this.callSid,
						interview_response_id: this.interviewResponse.id,
						interview_id: this.interviewResponse.interview.id,
						latency: userToOpenAILatency,
						team_id: this.interviewResponse.team_id,
					},
				})
				analytics.track({
					userId: 'system',
					event: 'OpenAI to Eleven Labs Send Latency',
					properties: {
						distinct_id: this.interviewResponse.id,
						call_sid: this.callSid,
						interview_response_id: this.interviewResponse.id,
						interview_id: this.interviewResponse.interview.id,
						latency: openAIToElevenLabsLatency,
						team_id: this.interviewResponse.team_id,
					},
				})
			} catch (error) {
				captureError(error)
			}

			let nodeId: string = this.lastCompletedNode.id
			const stepNumber = await getStepNumber(getLastUserMessages(this.interviewResponse.conversation_history), aiResponse, mermaidGraph, this.interviewResponse.interview.id, this.interviewResponse.interview.flow.edges)
			if (stepNumber !== -1) {
				nodeId = labelToNodeIdMap[stepNumber]
			}
			const matchingNode = this.interviewResponse.interview.flow.nodes.find(node => node.id === nodeId)
			this.lastCompletedNode = matchingNode

			if (!this.lastCompletedNode.data.times_visited) {
				this.lastCompletedNode.data.times_visited = 0
			}
			this.lastCompletedNode.data.times_visited++

			const result = await handleCompletionDataResponse({
				matchingNode,
			})
			if (typeof result === 'object' && '_shouldEndCall' in result) {
				const { _shouldEndCall, _shouldTransferCallTo, _actionDetail, _shouldTransferAgentTo } = result
				this.shouldEndCall = _shouldEndCall
				this.shouldTransferCallTo = _shouldTransferCallTo
				this.actionDetail = _actionDetail
				this.shouldTransferAgentTo = _shouldTransferAgentTo
			}

			if (!this.shouldContinueWithCompletion(dateUserStartedSpeaking)) {
				logger.debug('Transcription stopped, stopping completion after data promise')
				return
			}
			this.completionData = {
				action_detail: this.actionDetail,
				node_id: matchingNode.id,
			}
			if (this.interviewResponse) {
				await this.interviewResponse.save()
				if (this.interviewResponse.job) {
					this.interviewResponse.job.appendLog(`[${this.phoneNumberTo}]: User | ${transcript}`)
					this.interviewResponse.job.appendLog(`[${this.phoneNumberTo}]: AI | ${aiResponse}`)
				}
			}
			const safetyViolation = await safetyPromise
			if (safetyViolation) {
				this.interviewResponse.status = InterviewResponseStatus.VIOLATION
				logger.debug('Detected dangerous phrase, ending the call.')
				await this.interviewResponse.save()
				await this.onHangup('Safety violation detected')
			}
		} catch (error) {
			captureError(error)
		}
	}

	private onStartTranscribing() {
		logger.debug('Starting transcription')
		this.isTranscribing = true
		this.lastTranscriptChangeTime = new Date().getTime()
		this.lastTimeUserStartedSpeaking = new Date()
		this.elevenLabsText = ''
		this.audioChunkMap.clear()
		this.chunkSequence = 0
	}

	private async onHangup(reason: string) {
		logger.info(`Ending call (${this.interviewResponseId}): ${reason}`)

		this.didSystemInitiateHangup = true
		const accountSid = this.interviewResponse.type === InterviewResponseType.AGENT_TRANSFER
			? process.env.TWILIO_ACCOUNT_SID
			: this.accountSid
		try {
			await withExponentialBackoff(async () => {
				await twilioClientWithArgs({ accountSid }).calls(this.callSid).update({ status: 'completed' })
			})
			logger.info('Call ended successfully')
		} catch (error) {
			logger.error('Error ending the call', error)
			captureError(error)
		}
	}

	private sendQueueForTranscriptionService() {
		if (this.audioQueue.length > 0) {
			const packet = this.audioQueue.shift()
			if (this.transcriptionStream) {
				this.transcriptionStream.send(packet)
				setImmediate(() => this.sendQueueForTranscriptionService())
			} else {
				logger.error('Transcription stream is not available')
			}
		}
	}

	private queueForTranscriptionService(data: any) {
		if (this.audioQueue.length > this.audioQueueMaxSize) {
			logger.error(`Queue is full, dropping audio packet. Current size: ${this.audioQueue.length}`)
			return
		} else if (this.audioQueue.length > this.audioQueueWarningThreshold) {
			logger.warn(`Queue size warning: ${this.audioQueue.length}`)
		}
		this.audioQueue.push(data)
	}

	private sendToTranscriptionService(data: any) {
		if (this.transcriptionStream && this.transcriptionStream.getReadyState() === ConnectionState.OPEN) {
			this.transcriptionStream.send(data)
		} else {
			logger.debug('Buffering data due to closed Deepgram socket')
			this.queueForTranscriptionService(data)
		}
	}

	private async onInterimTranscript(data: LiveTranscriptionResponse) {
		try {
			const transcript = data.channel.alternatives[0].transcript
			const newTranscript = `${this.interimTranscript} ${transcript}`.trim()
			if (newTranscript.trim().length === 0) {
				return
			}

			if (!this.isTranscribing) {
				const numAgentMessages = this.interviewResponse.conversation_history.filter(
					(message) => message.author === 'ai'
				).length
				if (numAgentMessages === 1) {
					// Don't interrupt if the agent has only sent one message
					return
				}
				if (this.isUserWordIgnorable(transcript.toLowerCase())) {
					logger.info(`Ignoring interjection from user: ${transcript}`)
					return
				}
				this.setUserInterrupted(true)
				logger.info(`User interrupted agent: ${transcript}`)
				// this.interruptEventEmitter.emit('stop')
				this.onStartTranscribing()
				this.callMediaQueue.clear()
			}

			logger.info(`Received transcript: ${transcript}`)
			const isFullTranscriptEmpty = newTranscript.length === 0
			if (transcript.trim().length !== 0) {
				this.lastTranscriptChangeTime = new Date().getTime()
			}

			if (data.is_final && transcript) {
				this.interimTranscript = newTranscript
				logger.info(`Interim transcript updated: ${newTranscript}`)
			}

			if (transcript) {
				if (this.remainingAgentTryLimit !== this.agentTryLimit) {
					logger.info(`User started speaking, clearing silence timeout and resetting agent speak count to ${this.agentTryLimit}`)
					this.remainingAgentTryLimit = this.agentTryLimit
				}
				this.isRepeating = false
				this.clearSilenceTimeout()
			}

			if (data.speech_final && !isFullTranscriptEmpty) {
				logger.info('Ending transcription: speech_final')
				return await this.onFinishTalking(newTranscript, this.lastTimeUserStartedSpeaking)
			}

			const currentSilenceDuration = new Date().getTime() - this.lastTranscriptChangeTime
			const silenceThreshold = 250 // 3 seconds of silence
			if (currentSilenceDuration > silenceThreshold && !isFullTranscriptEmpty) {
				logger.info(`Ending transcription: silence for ${currentSilenceDuration} ms`)
				return await this.onFinishTalking(this.interimTranscript, this.lastTimeUserStartedSpeaking)
			}

			if (currentSilenceDuration > 250) {
				logger.info('Ending transcription: timeout')
				return await this.onFinishTalking(this.interimTranscript, this.lastTimeUserStartedSpeaking)
			}
		} catch (error) {
			captureError(error)
		}
	}

	private initTranscriptionStream() {
		this.transcriptionStream = getDeepgram().transcription.live({
			smart_format: false,
			interim_results: true,
			language: this.lang,
			model: getModelByLanguage(InterviewLanguage[this.lang]),
			endpointing: 50,
			filler_words: true,
			encoding: 'mulaw',
			sample_rate: 8000,
			keywords: ['Thoughtly'],
		})

		this.transcriptionStream
			.addListener('transcriptReceived', (message) => {
				const data = JSON.parse(message)
				if (data.type === 'Results') {
					this.onInterimTranscript(data)
				} else {
					logger.debug(`Received transcript data: ${JSON.stringify(data, null, 2)}`)
				}
			})
			.addListener('close', () => {
				logger.debug('Transcription stream closed')
				this.transcriptionStream = null
			})
			.addListener('open', () => {
				logger.debug('Transcription stream connected')
				this.sendQueueForTranscriptionService()
				this.createInterruptableWordsForLanguage(InterviewLanguage[this.lang])
			})
			.addListener('error', (error) => {
				captureError(error)
			})
	}

}

export default (socket: WebSocket) => new VirtualAgent(socket)
