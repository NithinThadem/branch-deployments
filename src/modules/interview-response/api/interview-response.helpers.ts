/* eslint-disable max-len */
import EventUtil from '../../../services/event'
import { uploadFile } from '../../../services/google/storage'
import { cosineSimilarity, vectorizeTexts, withExponentialBackoff } from '../../../util/helpers.util'
import logger from '../../../util/logger.util'
import { ContactEntity } from '../../contact/db/contact.entity'
import { getInterviewPrompt, replacePlaceholders } from '../../interview-flow/db/interview-flow.helpers'
import { synthesizeSpeech } from '../../interview/api/interview.helpers'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { JobEntity } from '../../job/db/job.entity'
import { isTeamOverAllowedMinutes } from '../../subscription/db/subscription.helpers'
import { TeamEntity } from '../../team/db/team.entity'
import { InterviewResponseEntity } from '../db/interview-response.entity'
import {
	ConversationHistory, InterviewResponseStatus, InterviewResponseType, TriggeredMetadata,
} from '../db/interview-response.types'
import analytics from '../../../services/segment'
import { captureError } from '../../../util/error.util'
import { JobStatus } from '../../job/db/job.types'
import { DataPointEntity } from '../../data-point/db/data-point.entity'
import { DataPointType } from '../../data-point/db/data-point.types'
import { saveUsageFromInterviewResponse } from '../../usage/db/usage.helpers'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { vectorizePrompt } from '../../genius/db/genius.helpers'

const dangerWords = ['sorry', 'unable']
const SIMILARITY_THRESHOLD = 65

export const generateInitialConversationHistory = async ({
	interview,
	format,
	contact,
	type,
	metadata,
	attempt = 0,
	generateVoicemail,
}: {
	interview: InterviewEntity,
	format?: string,
	contact?: ContactEntity,
	type?: InterviewResponseType
	metadata?: Record<string, string>
	attempt?: number
	generateVoicemail?: boolean
}): Promise<ConversationHistory[]> => {
	logger.debug(`Generating initial conversation history for interview: ${interview.id}`)

	const systemMessage = {
		role: 'system',
		content: await getInterviewPrompt({ interview, contact, metadata }),
	}

	const { choices: mainResponse } = await Promise.race([
		withExponentialBackoff(() => azureAi({
			team_id: interview.team.id,
			'Helicone-Property-Feature': 'Initial Conversation History',
			'Helicone-Property-InterviewId': interview.id,
			model: AzureOpenAIModels.GPT_4_O,
		}).chat.completions.create({
			model: OpenAIModels.GPT_4_O,
			messages: [systemMessage as any],
			// temperature: 0.2,
		})),
		new Promise((resolve) => setTimeout(resolve, 30 * 1000))
			.then(() => {
				throw new Error('Failed to generate initial conversation history in time')
			}),
	])

	let aiResponse = mainResponse[0].message.content
	aiResponse = aiResponse
		.replace(`${interview.ai_name}:`, '')
		.replace(/STEP \d+: /g, '')

	try {
		const startNodeDescription = interview.flow.nodes[0]?.data?.description || ''

		// ai response includes danger words and node description does not include
		if (dangerWords.some(w => aiResponse.toLowerCase().includes(w)) && !dangerWords.some(w => startNodeDescription.toLowerCase().includes(w))) {
			// vectorize
			const [vector1, vector2] = vectorizeTexts(startNodeDescription, aiResponse)

			// compare those vectors
			const similarity = Math.floor(cosineSimilarity(vector1, vector2) * 100)

			// re-run
			if (similarity < SIMILARITY_THRESHOLD) {
				// todo
				if (attempt < 2) {
					logger.info(`Reinitiating the generateInitialConversationHistory function... attempt ${attempt + 1}`)
					return generateInitialConversationHistory({
						interview,
						format,
						contact,
						type,
						metadata,
						attempt: attempt + 1,
						generateVoicemail,
					})
				} else {
					// maximum attempt reached. just continue
					logger.info('Maximum attempt reached, continuing...')
				}
			}
		}
	} catch (error) {
		captureError(error)
	}

	if (type === InterviewResponseType.BROWSER_TEXT) {
		return [
			{
				date: new Date(),
				author: 'system',
				text: systemMessage.content,
				cumulative_duration_ms: 0,
			},
			{
				date: new Date(),
				author: 'ai',
				text: aiResponse,
				cumulative_duration_ms: 0,
			},
		]
	}

	logger.debug(`Synthesizing AI response: ${aiResponse}`)

	const messages: ConversationHistory[] = [
		{
			date: new Date(),
			author: 'system',
			text: systemMessage.content,
			cumulative_duration_ms: 0,
		},
		{
			date: new Date(),
			author: 'ai',
			text: aiResponse,
			cumulative_duration_ms: 0,
		},
	]

	if (
		generateVoicemail &&
		interview.should_leave_voicemail &&
		interview.voicemail_message.length > 0
	) {
		messages[1].voicemail_content = replacePlaceholders(interview.voicemail_message, contact)
		logger.debug(`Synthesizing voicemail response: ${messages[1].voicemail_content}`)
	}

	if (
		type !== InterviewResponseType.SMS &&
		type !== InterviewResponseType.WIDGET
	) {
		await Promise.all([
			(async () => {
				const speechAudio = await synthesizeSpeech(aiResponse, interview.ai_name, format || 'ulaw_8000')
				messages[1].audio_url = await uploadFile(format === 'ulaw_8000' ? 'wav' : 'mp3', speechAudio)
			})(),
			messages[1].voicemail_content && (async () => {
				const voicemailAudio = await synthesizeSpeech(messages[1].voicemail_content, interview.ai_name)
				messages[1].voicemail_audio_url = await uploadFile('mp3', voicemailAudio)
			})(),
		])
	}

	analytics.track({
		userId: 'system',
		event: 'Interview Started',
		properties: {
			interview_id: interview.id,
			team_id: interview.team.id,
			contact_id: contact?.id,
			response_type: type,
			ai_name: interview.ai_name,
			language: interview.lang,
		},
	})

	return messages
}

export const onInterviewStart = async (args: {
	interview: InterviewEntity
	format?: 'ulaw_8000' | 'mp3_44100'
	team: TeamEntity
	twilio_sid?: string
	type: InterviewResponseType
	contact: ContactEntity | null
	conversationHistory?: ConversationHistory[]
	job?: JobEntity
	metadata?: Record<string, string>,
	triggered_metadata?: TriggeredMetadata
	direction: 'inbound' | 'outbound'
}): Promise<InterviewResponseEntity> => {
	if (await isTeamOverAllowedMinutes(args.team)) {
		await EventUtil.asyncEmit('TEAM_OVER_ALLOWED_MINUTES', { team_id: args.team.id })
		throw new Error('Team has exceeded allowed minutes')
	}

	if (args.job && args.job.status === JobStatus.CANCELED) {
		logger.info(`Job ${args.job.id} has been canceled. Not starting the interview.`)
		return
	}

	logger.debug(`Starting interview: ${args.interview.id}`)

	const data = await InterviewResponseEntity.create({
		team: args.team,
		twilio_sid: args.twilio_sid,
		interview: args.interview,
		type: args.type,
		status: InterviewResponseStatus.NOT_STARTED,
		start_time: new Date(),
		phone_number: args.contact?.phone_number,
		ai_name: args.interview.ai_name,
		contact: args.contact,
		conversation_history: args.conversationHistory ||
			await generateInitialConversationHistory({
				interview: args.interview,
				format: args.format,
				contact: args.contact,
				type: args.type,
				metadata: args.metadata,
				generateVoicemail: args.direction === 'outbound',
			}),
		job: args.job,
		metadata: args.metadata,
		triggered_metadata: args.triggered_metadata,
	}).save()

	return data
}

export const onInterviewEnd = async (
	response: InterviewResponseEntity,
	callSid?: string,
	userEnded?: boolean,
	reason?: string,
) => {
	logger.debug(`Ending interview: ${response.id}`)
	response.status = response.status === InterviewResponseStatus.IN_PROGRESS ? InterviewResponseStatus.ENDED : InterviewResponseStatus.TRANSFERRED

	response.end_time = new Date()
	response.duration_ms = calculateTotalMilliseconds(response, 5 * 60 * 1000)

	await response.save()
	await saveUsageFromInterviewResponse(response)
		.catch(captureError)

	const shouldEmit = response.interview.should_record === false || !callSid

	if (shouldEmit) {
		await EventUtil.asyncEmit('INTERVIEW_END', {
			interview_response_id: response.id,
		})
	} else {
		logger.debug(`Recorded interview, not emitting INTERVIEW_END event: ${response.id}`)
	}

	try {
		const properties = {
			call_sid: callSid || 'N/A',
			interview_id: response.interview.id,
			date: response.end_time,
			team: response.team.name || response.team.id,
			language: response.interview.lang,
			reason: reason || 'N/A',
			duration_ms: response.duration_ms,
			team_id: response.team.id,
		}

		analytics.track({
			userId: 'system',
			event: 'Interview Ended',
			properties,
		})

		const endReason = userEnded ? 'USER_ENDED' : 'SYSTEM_ENDED'
		const endReasonDataPoint = new DataPointEntity()
		endReasonDataPoint.response_id = response.id
		endReasonDataPoint.interview_id = response.interview.id
		endReasonDataPoint.team_id = response.team.id
		endReasonDataPoint.response_type = response.type
		endReasonDataPoint.type = DataPointType.THOUGHTLY_END_DATA
		endReasonDataPoint.value = endReason
		endReasonDataPoint.metadata = {
			thoughtly_end: {
				reason: endReason,
				phone_number: response.phone_number,
				response_type: response.type,
				start_time: response.start_time,
				duration: response.duration_ms,
			},
		}
		await endReasonDataPoint.save()
	} catch (error) {
		captureError(error)
	}
}

export const formatTranscript = (interviewResponse: InterviewResponseEntity): string => {
	const transcript = interviewResponse.conversation_history
		.filter(({ author }) => author !== 'system')
		.map(({ text, author }) => `${author === 'user' ? 'Caller' : 'Agent'}: ${text}`)
		.join('\n\n')

	return transcript
}
export const formatTagsTranscript = (
	interviewResponse: InterviewResponseEntity
): string[] => {
	const transcript = []
	const history = interviewResponse.conversation_history

	for (let i = 0; i < history.length; i++) {
		if (history[i].author === 'ai') {
			const staffText = `**STAFF**: ${history[i].text}`
			let callerText = ''

			// Gather all consecutive user messages after an 'ai' message.
			while (i + 1 < history.length && history[i + 1].author === 'user') {
				if (callerText) {
					// If there's already text, add a space and the new message.
					callerText += ` | **CALLER**: ${history[i + 1].text}`
				} else {
					// Start the callerText string.
					callerText = `**CALLER**: ${history[i + 1].text}`
				}
				i++ // Increment to move to the next user message.
			}

			// Combine the question and all gathered answers in one line.
			transcript.push(`${staffText} | ${callerText}`)
		}
	}

	return transcript
}

function calculateTotalMilliseconds({ id, conversation_history }: InterviewResponseEntity, maxGap: number): number {
	let totalDuration = 0
	let previousDate: Date | null = null

	conversation_history.forEach((history) => {
		const currentDate = new Date(history.date)
		if (previousDate) {
			const gapDuration = currentDate.getTime() - previousDate.getTime()
			if (gapDuration <= maxGap) {
				totalDuration += gapDuration
			}
		}
		previousDate = currentDate
	})

	if (totalDuration < 0) {
		throw new Error(`Invalid (negative) duration detected for interview response: ${id}`)
	}

	return totalDuration
}

export const getPostInterviewAnalysis = async (interview_response_id: string) => {
	const interviewResponse = await InterviewResponseEntity.findOne({
		where: { id: interview_response_id },
		relations: ['interview'],
	})

	if (!interviewResponse) {
		logger.error(`Response ${interview_response_id} not found.`)
		return
	}
	// For each tag in the interview response, we will retrieve a list of conversations that match the tag.
	// We will then iterate over these conversations and check if the tag is reported by the model.
	// If the tag is reported, we add it to the list of reported tags.

	/**
	 * Retrieves the top k conversation snippets from a list of conversation vectors, sorted by cosine similarity.
	 * @param {number[]} tagVector - The vector representing the tag.
	 * @param {any[]} allVectors - An array of pairs, where each pair consists of a conversation vector and its corresponding original string text.
	 * @param {number} k - The number of top conversations to retrieve.
	 * @return {string[]} An array of top k conversation snippets, sorted in descending order of similarity.
	 */
	const searchTopKConversations = (tagVector: number[], allVectors: any[], k: number): string[] =>
		allVectors
			.map(([vector, originalText]) => ({ // Destructure each pair and compute similarity
				text: originalText,
				similarity: cosineSimilarity(tagVector, vector),
			}))
			.sort((a, b) => b.similarity - a.similarity) // Sort by similarity in descending order
			.slice(0, k) // Get the top k elements
			.map(item => item.text) // Return the texts of the top k most similar entries

	const openaiConfig = {
		team_id: interviewResponse.team_id,
		'Helicone-Property-Feature': 'Post Interview Analysis',
		'Helicone-Property-InterviewId': interviewResponse.interview.id,
		'Helicone-Property-InterviewResponseId': interviewResponse.id,
		model: AzureOpenAIModels.GPT_4_O,
	}

	// Data extraction model
	const openaiModel = OpenAIModels.GPT_4_O
	const nameTag = [
		'NAME', 'this is', 'who are', 'You reached', 'I am', 'My name is',
		'Please introduce', 'Who do I have the pleasure of speaking with?', 'Identify yourself', 'Who\'s calling',
	]

	const emailTag = [
		'EMAIL', 'My email is', 'at dot', 'reach me at', 'you can email',
		'send it to', 'My contact', 'drop me an email', 'Email address', 'Email contact',
	]
	const dncTag = [
		'DO NOT CALL AGAIN', 'dont', 'stop', 'spam', 'fuck',
		'no more calls', 'remove me', 'unsubscribe', 'never call',
	]

	const tagsTag = [
		...interviewResponse.interview.response_tags,
	]

	/**
	 * Retrieves analysis messages for a given interview response by performing data extraction on the response.
	 *
	 * @param {string} systemMessage - The system message to guide the data labeler.
	 * @param {string} userMessage - The user message containing the demand for data identification.
	 * @param {InterviewResponseEntity} interviewResponse - The interview response to analyze.
	 * @param {string[]} tagsArray - The array of tags to search for.
	 * @param {number} k - The number of top conversations to retrieve.
	 * @param {boolean} [hasAdditionalTags] - Indicates if there are additional tags used to assist ambiguous tags like email and name that could be missed in the convosation.
	 * @param {string} [additionalTagKey] - The key for the single tag to report.
	 * @return {Promise<any[]>} An array of analysis messages.
	 */
	const getAnalysisMessages = async (
		systemMessage: string,
		userMessage: string,
		interviewResponse: InterviewResponseEntity,
		tagsArray: string[],
		k: number,
		hasAdditionalTags?: boolean,
		additionalTagKey?: string,
		retryCount: number = 0
	): Promise<any> => {
		const responseToAnalyze = formatTagsTranscript(interviewResponse)
		const vectorMessages = []

		for (const message of responseToAnalyze) {
			const vectorMessage = await vectorizePrompt(message)
			vectorMessages.push([vectorMessage, message])
		}

		const tagsList = []

		try {
			for (const tag of tagsArray) {
				const tagVector = await vectorizePrompt(tag)
				const topKConversations = searchTopKConversations(
					tagVector,
					vectorMessages,
					k
				).join('\n\n')
				const tagPicked = await azureAi(openaiConfig)
					.chat.completions.create({
						model: openaiModel,
						response_format: { type: 'json_object' },
						temperature: 0.0,
						messages: [
							{
								role: 'system',
								content: `You are a data labeler. You try to meet user's demand on identifying data with JSON output. You only respond in JSON mode based on the example format here: ${systemMessage}. You should only identify tags given to you, never label any tags that are not explicitly given to you by the user.
								**Return the output as JSON, nothing else**`,
							},
							{
								role: 'user',
								content: `Return only in JSON Mode where you meet the following demand:${userMessage} for the tag here \n**tag**: ${tag}\nbased on the conversation history\n**conversation histroy**${topKConversations}**conversation history**\nreturn your response in JSON format`,
							},
						],
						stream: false,
					})
				if (!hasAdditionalTags) {
					tagsList.push(JSON.parse(tagPicked.choices[0].message.content))
				} else {
					if (tagsList.length === 0) {
						tagsList.push(JSON.parse(tagPicked.choices[0].message.content))
					} else {
						const currentTag = tagsList.pop()
						if (currentTag && JSON.parse(tagPicked.choices[0].message.content).additionalTagKey && JSON.parse(tagPicked.choices[0].message.content).additionalTagKey !== 'None') {
							const newTag = JSON.stringify(` {${additionalTagKey}: ${JSON.parse(tagPicked.choices[0].message.content).additionalTagKey}} `)
							tagsList.push(newTag)
						} else {
							tagsList.push(currentTag)
						}
					}
				}
			}
		} catch (error) {
			logger.error('Failed to get analysis messages', error)
			captureError(error)
			if (retryCount < 10) {
				return await getAnalysisMessages(systemMessage, userMessage, interviewResponse, tagsArray, k, hasAdditionalTags, additionalTagKey, retryCount + 1)
			} else {
				logger.error('Retry limit reached')
				return []
			}
		}
		return tagsList
	}

	const getSummaryMessage = (prompt: string) => [
		{
			role: 'user',
			content: `${prompt}\n\n<conversation summary>${formatTranscript(interviewResponse)}</conversation summary>`,
		},
	] as any

	try {
		const [summary, name, email, dnc, tags] = await Promise.all([
			azureAi(openaiConfig)
				.chat.completions.create({
					model: openaiModel,
					messages: getSummaryMessage(
						'Provide a summary of the conversation. This should be a brief overview of the key points discussed. Do not include any personal information.',
					),
					stream: false,
				})
				.then(({ choices }) => choices[0].message.content)
				.catch((error) => {
					logger.error('Failed to get summary message', error)
					captureError(error)
					return undefined
				}),
			getAnalysisMessages(
				'Identify and return only the name of the caller from the transcript. Your response should follow the format: {"name": "**name if mentioned**" or  None}.',
				'Find the caller name if it is mentioned in the conversation. Do not include any other text. Return only in JSON format. **EXAMPLE**: if the name is mentioned, return {"name": "**insert name mentioned here**"}. If the name is not mentioned, return {"name": None}',
				interviewResponse,
				nameTag,
				5,
				true,
				'name'

			)
				.then(messages => messages[0]?.name)
				.catch((error) => {
					logger.error('Failed to get name message', error)
					captureError(error)
					return undefined
				}),
			getAnalysisMessages(
				'Identify and return only the email of the caller from the transcript. Your response should follow the format: {"email": "**email if mentioned**" or  None}.',
				'Analyze the below conversation and return the caller email. If there is no email provided, return an empty string. Do not return any additional information or context, only the email address. Ensure that your response contains only a valid email address, stripped of any surrounding text, phrases, or punctuation. **EXAMPLE**: If the email is "XaC6T@example.com", return {"email": "XaC6T@example.com"}. If the email is not mentioned, return {"email": None}',
				interviewResponse,
				emailTag,
				5,
				true,
				'email'
			)
				.then(messages => messages[0]?.email)
				.catch((error) => {
					logger.error('Failed to get email message', error)
					captureError(error)
					return undefined
				}),
			getAnalysisMessages(
				'Identify and return only the whether the caller has requested not to be contacted again. Your response should follow the format to return a JSON object with value being a boolean: {"dnc": true or false}.',
				'Analyze the below conversation and determine if the person has requested not to be contacted again. If so, return JSON object { "dnc": true }. If not, return JSON object { "dnc": false }',
				interviewResponse,
				dncTag,
				5,
				true,
				'dnc'
			).then(messages => messages[0]?.dnc)
				.catch((error) => {
					logger.error('Failed to get dnc message', error)
					captureError(error)
					return undefined
				}),
			getAnalysisMessages(
				'Identify and return only the boolean values based on whether a customized tag should be labeled as true by the caller response. Your response should follow the format to return a JSON object with key being the tag passed in to you and value being a boolean: { some given tag: true or false}',
				'Analyze the transcript and return a JSON object with the following structure: { some given tag: true or false } where some given tag is the tag passed in to you. Do not imagine tags, only respond to the tag asked by me',
				interviewResponse,
				tagsTag,
				5,
				false,
				''
			)
				.then(choices => {
					const tagsArray = choices
						.map(choice => {
							// Assuming each choice is an object with a single key-value pair
							const key = Object.keys(choice)[0] // Get the first key of the object
							const value = choice[key] // Access the value using the key
							return value === true ? key : null // Return the key if the value is true, otherwise return null
						})
						.filter(key => key !== null)

					return tagsArray
				})
				.catch((error) => {
					logger.error(`Error extracting tags: ${error.message}`)
					captureError(error)
					return []
				}),
		])
		return {
			summary,
			name,
			email,
			dnc,
			tags,
		}
	} catch (error) {
		captureError(error)
	}
}
