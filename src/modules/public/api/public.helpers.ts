/* eslint-disable max-len */
import { ChatCompletionChunk, ChatCompletionCreateParams } from 'openai/resources/chat'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { ConversationHistory } from '../../interview-response/db/interview-response.types'
import { captureError } from '../../../util/error.util'
import EventEmitter from 'events'
import promptArmor from '../../../services/promptarmor'
import logger from '../../../util/logger.util'
import { translate } from '../../../services/i18n'
import analytics from '../../../services/segment'
import { InterviewNode } from '../../../modules/interview-flow/db/interview-flow.types'
import { Stream } from 'openai/streaming'
import { MistralModels, mistral } from '../../../services/mistral'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { GroqModels, groq } from './../../../services/groq'

/**
 * Returns the concatenated text of the last user messages in the given conversation history.
 *
 * @param {ConversationHistory[]} msgParams - The array of conversation history objects.
 * @return {string} The concatenated text of the last user messages.
 */
export const getLastUserMessages = (msgParams: ConversationHistory[]): string => {
	const lastNonUserMsgIndex = [...msgParams].reverse().findIndex(msg => msg.author !== 'user')
	const cutoffIndex = msgParams.length - 1 - lastNonUserMsgIndex
	const lastUserMessages = msgParams.slice(cutoffIndex + 1).map(msg => msg.text)
	return lastUserMessages.join(' ')
}

export const chatCompletionIterator = async ({
	messages: msgParams,
	timeoutMs,
	// interimAnalysis,
	interruptEventEmitter,
	responseId,
	interviewId,
	teamId,
	script,
	secondaryActionOutputs,
}: {
	messages: ConversationHistory[]
	timeoutMs: number
	interimAnalysis?: string
	interruptEventEmitter?: EventEmitter
	responseId?: string
	interviewId?: string
	script?: string
	teamId?: string
	secondaryActionOutputs?: object
}): Promise<[
	Promise<AsyncGenerator<string>>,
	Promise<boolean>,
	Promise<string>,
]> => {
	let resolveGenerator: (value: AsyncGenerator<string>) => void
	let resolveAnalysis: (value: string) => void
	let resolveSafety: (value: boolean) => void

	const generatorPromise = new Promise<AsyncGenerator<string>>((resolve) => { resolveGenerator = resolve })

	const analysisPromise = new Promise<string>((resolve) => { resolveAnalysis = resolve })

	const safetyPromise = new Promise<boolean>((resolve) => { resolveSafety = resolve })

	const latestSystemMessage = []
	// const lastUserMessages = [...msgParams]
	// 	.reverse()
	// 	.filter(message => message.author === 'user')
	// 	.slice(0, 10)
	// 	.map(message => message.text)
	// 	.reverse()
	// 	.join('\n\n')
	const firstSystemMessage = msgParams.find(message => message.author === 'system')?.text
	const personalitySection = firstSystemMessage?.split('**Personality Instructions:**')[1]?.split('**Script:**')[0]?.trim()

	const startTime = Date.now()
	let abort = false
	promptArmor.inputAnalysis({
		input: getLastUserMessages(msgParams),
		sessionId: responseId !== 'preview' ? responseId : undefined,
		source: interviewId,
	}).then(analysis => {
		if (analysis.isAdversarial) {
			logger.warn(`[${responseId}] Adversarial prompt detected. Aborting the LLM request.`)
			analytics.track({
				anonymousId: responseId,
				event: 'Adversarial Prompt Detected',
				properties: {
					step: 'Abort',
					interviewId,
					responseId,
				},
			})
			resolveAnalysis(translate('response.adversarial_abort', {}, { lang: 'en' }))
			resolveGenerator((async function* () {
				yield translate('response.cannot_help', {}, { lang: 'en' })
			})())
			abort = true
		}
	}).catch((error) => logger.warn(`[${responseId}] PromptArmor analysis error: ${error}`))

	interruptEventEmitter?.on('interrupt', () => {
		abort = true
	})

	const messages = msgParams.map((message) => ({
		role: message.author === 'ai' ? 'assistant' : message.author,
		content: message.text,
	}))

	// Add secondary action responses to the messages
	if (secondaryActionOutputs) {
		const actionMessages = generateActionResponseMessages(secondaryActionOutputs)
		messages.push(...actionMessages)
	}

	if (personalitySection) {
		messages.push({
			role: 'system',
			content: `**Personality Configuration:**\n${personalitySection}\n\nConfigure your response to be in tune with the following personality configuration. Combine what to say with how to say it, considering assertiveness the different levels of personality type given`,
		})
	}

	if (latestSystemMessage.length) {
		messages.push({
			role: 'system',
			content: latestSystemMessage.join('\n'),
		})
	}

	messages.push({
		role: 'system',
		content: `Here is the following script to chose where to go next ${script}`,
	})

	const allMessages = messages.map((message) => message.content).join('\n\n')
	const edgeCount = allMessages.split('-->').length - 1

	const useGroq = teamId === '2b79c3ff-b6d3-4706-a136-0caca04ffc60'

	const chosenModel = useGroq ? GroqModels.LLAMA_3_70B : OpenAIModels.GPT_4_O
	const chosenProvider = useGroq ? groq : azureAi

	logger.info(`[${responseId}] Chosen model: ${chosenProvider.name} | ${chosenModel}`)

	const completionArgs: ChatCompletionCreateParams.ChatCompletionCreateParamsStreaming = {
		model: chosenModel,
		messages: messages as any,
		stream: true,
	}

	// const safetyArgs = (userMessages: string) => ({
	// 	model: ClaudeModels.CLAUDE_3_OPUS,
	// 	system: 'Decide if the user given conversation violates the following rules:\n1.No promotion of harmful, unethical, or illegal activity\n2.No discriminative, hateful speech toward anyone or anything\n3. No sexual information or activities harmful for people under the age of 18\n **Respond only in JSON of the format { violation: true or false }**',
	// 	messages: [
	// 		{
	// 			role: 'user',
	// 			content: userMessages + '\n\nreply only in JSON { violation: true or false }',
	// 		},
	// 		{
	// 			role: 'assistant',
	// 			content: '{',
	// 		},
	// 	],
	// 	stream: false,
	// 	max_tokens: 128,
	// }) as Anthropic.MessageCreateParamsNonStreaming

	// 	const toolsArgs = (messagesContent: string) => ({
	// 		model: OpenAIModels.GPT_4_O,
	// 		messages: [
	// 			{
	// 				role: 'system',
	// 				content: messagesContent,
	// 			},
	// 		],
	// 		stream: false,
	// 	} as ChatCompletionCreateParams.ChatCompletionCreateParamsNonStreaming)

	const [
		chatStream,
		// toolsCompletion,
		// analysisCompletion,
	] = ([
		await chosenProvider({
			team_id: teamId,
			'Helicone-Property-Feature': 'Conversation: Chat',
			'Helicone-Property-InterviewId': interviewId,
			'Helicone-Property-InterviewResponseId': responseId,
			model: chosenModel,
		}).chat.completions.create(completionArgs)
			.catch((error) => {
				if (useGroq) {
					logger.error(`[${responseId}] Groq chat completion error: ${error}`)
					return azureAi({ model: AzureOpenAIModels.GPT_4_O }).chat.completions.create({
						...completionArgs,
						model: OpenAIModels.GPT_4_O,
					})
				}
				return groq().chat.completions.create({
					...completionArgs,
					model: GroqModels.LLAMA_3_70B,
				})
			}),
		// openai().chat.completions.create(toolsArgs),
		// openai().chat.completions.create(analysisArgs),
	])

	let timer: NodeJS.Timeout | null = null

	const onFirstByte = () => {
		try {
			const ttfb = Date.now() - startTime
			logger.info(`[${responseId}] TTFB: ${ttfb}ms, chosen model: ${chosenModel}`)

			analytics.track({
				userId: 'system',
				event: 'Model Latency',
				properties: {
					model: chosenModel,
					ttfb,
					edgeCount,
					interviewId,
					responseId,
					team_id: teamId,
				},
			})
		} catch (error) {
			captureError(error)
		}
	}

	timer = setTimeout(() => {
		clearTimeout(timer)
		throw new Error('Chat completion timed out')
	}, timeoutMs)

	resolveGenerator(textChunker(textIterator(
		chatStream,
		abort,
		timer,
		onFirstByte,
	)))

	// analysisCompletion.then((data) => {
	//  logger.debug(`Analysis completion: ${data.choices[0].message.content}`)
	//  resolveAnalysis(data.choices[0].message.content)
	// }).catch(captureError)

	resolveAnalysis('')

	async function safetyDetector(maxAttempts = 3) {
		// try {
		//  const safetyResponse = await claude({
		//      team_id: teamId,
		//      'Helicone-Property-Feature': 'Trust and Safety',
		//      'Helicone-Property-InterviewId': interviewId,
		//      'Helicone-Property-InterviewResponseId': responseId,
		//  }).messages.create(safetyArgs(lastUserMessages))

		//  const firstBlock = safetyResponse.content[0]
		//  if (firstBlock.type === 'text' && 'text' in firstBlock) {
		//      return JSON.parse('{' + firstBlock.text).violation
		//  }
		// } catch (error) {
		//  if (maxAttempts > 0) {
		//      return safetyDetector(maxAttempts - 1)
		//  } else {
		//      return false
		//  }
		// }
		return false
	}

	resolveSafety(await safetyDetector())

	return [generatorPromise, safetyPromise, analysisPromise]
}

export const textIterator = async function* (
	chatStream: Stream<ChatCompletionChunk>,
	abort: boolean,
	timer?: NodeJS.Timeout,
	onStart?: () => void,
	onEnd?: (...args: string[]) => void
) {
	let accumulatedMessage = ''
	let didFirstByte = false

	for await (const chunk of chatStream) {
		if (chunk.choices[0]) {
			const delta = chunk.choices[0].delta || {}

			if (delta.content === null) {
				continue
			}

			if (!didFirstByte && onStart) {
				onStart()
				didFirstByte = true
			}

			if (chunk.choices[0].finish_reason !== null) {
				break
			}

			if (delta?.content) {
				accumulatedMessage += delta.content
			}

			if (abort) {
				chatStream.controller.abort()
				// TODO: stop toolsCompletion and analysisCompletion
			} else {
				yield delta?.content
			}

			clearTimeout(timer)
		}
	}

	if (onEnd) {
		console.log('end')
		onEnd(accumulatedMessage)
	}
}

async function* textChunker(chunks) {
	const splitters = ['.', ',', '?', '!', ';', ':', '—', '-', '(', ')', '[', ']', '}', ' ']
	let buffer = ''
	for await (const text of chunks) {
		const cleanText = text.replace(/["{}]/g, '').split('","step_number":')[0]
		if (splitters.includes(cleanText)) {
			buffer += cleanText + ' '
		} else if (buffer.endsWith(splitters.join(' '))) {
			yield buffer
			buffer = cleanText
		} else if (splitters.includes(cleanText[0])) {
			yield buffer + cleanText[0] + ' '
			buffer = cleanText.slice(1)
		} else {
			buffer += cleanText
		}
	}

	if (buffer) {
		yield buffer
	}
}

export const getDataPointsForNode = async (args: {
	node: InterviewNode,
	userAnswer: string
	interviewId: string
	responseId: string
}) => {
	const question = args.node.data.description
	const userAnswer = args.userAnswer

	let prompt = `What did the user answer to the following question?\n\nQuestion: ${question}\nUser Answer: ${userAnswer}\n\nReturn only the exact value of the answer, directly and precisely. Do not include any reasoning or explanations.`

	if (args.node.data.outcomes) {
		prompt += `\n\nPossible outcomes are: ${JSON.stringify(args.node.data.outcomes)}
			Return the exact match from these outcomes if the user's answer is clearly one of them. If the user's answer is numeric (e.g., "one", "eleven", "thirty-five"), convert and return it as a numeric value (e.g., 1, 11, 35).
			If no exact match is found and no conversion is applicable, return the user's answer as is, ensuring it is just a simple value without any elaboration or sentence structure.`
	} else {
		prompt += "\n\nIf no specific outcomes are provided, return the user's answer as a straightforward value, without any additional text or explanation."
	}

	const { choices } = await withExponentialBackoff(() => mistral({
		'Helicone-Property-Feature': 'Node Data Points',
		'Helicone-Property-InterviewId': args.interviewId,
		'Helicone-Property-InterviewResponseId': args.responseId,
	}).chat.completions.create({
		model: MistralModels.MIXTRAL_8x22b,
		temperature: 0.5,
		messages: [
			{
				role: 'system',
				content: prompt,
			},
		],
	}))

	return choices[0].message.content
}

export const findActionToRun = async (args: {
	nodes: InterviewNode[],
	lastCompletedNode: InterviewNode,
	userAnswer: string
	interviewId: string
	responseId: string
}) => {
	const question = args.lastCompletedNode.data.description
	const userAnswer = args.userAnswer

	const nodeDescriptions = args.nodes.map((node, index) => {
		if (node.data.api_request) {
			const apiName = node.data.api_request.name || `API Call ${index + 1}`
			const url = node.data.api_request.url
			const method = node.data.api_request.method
			return `${index + 1}. ${apiName} - URL: ${url}, Method: ${method}`
		} else {
			return `${index + 1}. No API request details provided`
		}
	}).join('\n')

	const prompt = `Based on the user's response to the question below, which API call should be initiated?\n\nQuestion: ${question}\nUser Answer: ${userAnswer}\n\nChoose from the following options:\n${nodeDescriptions}\n\nPlease return only the number corresponding to the API call that should be executed with JSON format { node: <number> }.`

	let attempts = 0
	while (attempts < 3) {
		try {
			const { choices } = await azureAi({
				'Helicone-Property-Feature': 'Conversation: API Node Selection',
				'Helicone-Property-InterviewId': args.interviewId,
				'Helicone-Property-InterviewResponseId': args.responseId,
				model: AzureOpenAIModels.GPT_4_O,
			}).chat.completions.create({
				model: OpenAIModels.GPT_4_O,
				temperature: 0.5,
				response_format: { type: 'json_object' },
				messages: [
					{
						role: 'system',
						content: prompt,
					},
					{
						role: 'user',
						content: 'What is the best API node to go to? Respond only with the number of the node with JSON format { node: <number> }',
					},
				],
			})
			const chosenIndex = JSON.parse(choices[0].message.content).node
			if (chosenIndex >= 0 && chosenIndex < args.nodes.length) {
				return args.nodes[chosenIndex].id
			} else {
				throw new Error('Invalid node selection returned from model')
			}
		} catch (error) {
			attempts++
			if (attempts >= 3) {
				return -1
			}
		}
	}
}

/**
* Helper function to get messages for completion, including vector response, conversation history, and call summaries
*
* @param vectorResponse string[] - Vector response to be included in the conversation history
* @param conversation_history ConversationHistory[] - Conversation history to be modified
* @param callSummaries SummaryData[] - Call summaries to be included in the conversation history
* @param interviewType InterviewType - Interview type
* @returns { ConversationHistory[] } modified conversation history
*/
export const getMessagesForCompletion = ({
	vectorResponse,
	conversation_history,
}: {
	vectorResponse?: string[]
	conversation_history: ConversationHistory[]
}): ConversationHistory[] => {
	let response = []

	if (vectorResponse &&
		Array.isArray(vectorResponse) &&
		vectorResponse.length
	) {
		response = [
			{
				date: new Date(),
				author: 'system',
				text: 'HELPFUL INFORMATION:' +
					`\n${vectorResponse?.join('\n')}`,
			},
			conversation_history[0],
			...conversation_history.slice(1),
		]
	} else {
		response = conversation_history
	}

	return response
}

export const sanitizeText = (text) => text
	.replace(/[\n{}]/g, '')
	.replace(/"\s*}/g, '"')
	.replace(/{\s*"/g, '"')
	.trim()

function generateActionResponseMessages(secondaryActionResponses) {
	const messages = []
	const additionalInfo = []

	if (!secondaryActionResponses || !Array.isArray(secondaryActionResponses) || !secondaryActionResponses.length) {
		return messages
	}

	// Generate messages for each action response
	secondaryActionResponses.forEach(response => {
		let content = ''
		if (response.actionType === 'API_CALL' && response.response && !response.response.error) {
			const formattedData = JSON.stringify(response.response.data, null, 2)
			content = `Action type: ${response.actionType} - Data retrieved from this API call: ${formattedData}`
			additionalInfo.push(content)
		} else if (response.actionType === 'CALCULATE' && response.response) {
			content = `Calculation result for Node ID: ${response.nodeId} - Result: ${response.response.data}`
			additionalInfo.push(content)
		}
	})

	if (additionalInfo.length) {
		messages.push({
			date: new Date(),
			role: 'system',
			content: `
				**Last Action Output:**
				Below are the details from the actions taken in your session. This information includes outputs from API calls or calculations you initiated. Use this data to inform your responses to the user:
				\n${additionalInfo.join('\n\n')}
				\nUse this information to guide your next interaction. Inform the user about the outcome of the action and address any questions they may have. If no specific question was asked, inform them that the information has been retrieved and inquire if there's anything specific they would like to know or do next.`,
		})
	}

	return messages
}

/**
 * Retrieves the step number from the conversation history and script.
 *
 * @param {string[]} conversation_history - The conversation history.
 * @param {string} script - The script.
 * @param {string} interviewId - The interview ID.
 * @param {string} responseId - The response ID.
 * @param {Edge[]} edges - The edges.
 * @return {Promise<number>} The step number.
 */
export const getStepNumber = async (lastUserMessage, lastAiMessage, script, interviewId, edges) => {
	logger.debug('Finished completion, removing all listeners and getting step number')

	const lastUserAIMessage = `User: ${lastUserMessage}\nAI:${lastAiMessage}`

	const formatScriptContent = (script) => script.split('\n')
		.filter(line => line.includes('SAY:'))
		.map(line => line.replace(/.*(\d+): \[SAY: "(.*)"\].*/, '$1: $2'))
		.join('\n\n')

	const formattedScriptContent = `**Script Content with indexes: \n ${formatScriptContent(script)}**`
	const messagesContent = [
		formattedScriptContent,
		'**Prompt***\n\nWhat index represents the AI\'s last response? Whichever Say message matches the closest will be the index to choose. Reply only with JSON format { index: <number> }\n\n**Prompt***',
	]

	const prompt = messagesContent.join('\n\n')

	let attempts = 0
	let step = -1

	while (attempts < 10) {
		try {
			const { choices } = await azureAi({
				'Helicone-Property-Feature': 'Conversation: Step Number',
				'Helicone-Property-InterviewId': interviewId,
				model: AzureOpenAIModels.GPT_4_O,
			}).chat.completions.create({
				model: OpenAIModels.GPT_4_O,
				temperature: 0,
				response_format: { type: 'json_object' },
				messages: [
					{
						role: 'system',
						content: prompt,
					},
					{
						role: 'user',
						content: `What is the closest matching content to what the AI said here? ${lastUserAIMessage} Respond only with the number of the node with JSON format { index: <number> }`,
					},
				],
			})

			const parsedContent = JSON.parse(choices[0].message.content)
			step = parsedContent.index

			if (!isNaN(step) && step !== -1) {
				return step
			} else {
				throw new Error('Invalid response format')
			}
		} catch (error) {
			attempts++
			logger.warn(`Attempt ${attempts} failed:`, error.message)
			if (attempts >= 10) {
				logger.warn('Invalid step number after 10 attempts')
				return -1
			}
		}
	}

	analytics.track({
		userId: 'system',
		event: 'Completion Step Number',
		properties: {
			step,
			model: OpenAIModels.GPT_4_O,
			edgeCount: edges.length,
			interviewId,
		},
	})
}
