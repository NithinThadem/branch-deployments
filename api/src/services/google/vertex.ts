/* eslint-disable no-cond-assign */
/* eslint-disable max-len */
import { VertexAI, GenerateContentResponse, Content } from '@google-cloud/vertexai'
import { ChatCompletionChunk } from 'openai/resources'
import { Stream } from 'openai/streaming'
import { ConversationHistory } from '../../modules/interview-response/db/interview-response.types'

const vertexAi = new VertexAI({
	project: process.env.GCP_PROJECT_ID,
	location: 'us-east4',
})

export const geminiPro = () => vertexAi.preview.getGenerativeModel({
	model: 'gemini-pro',
})

export const geminiGeneratorToOpenAI = (
	stream: AsyncGenerator<GenerateContentResponse>
): Stream<ChatCompletionChunk> => {
	const controller = new AbortController()

	const iterator = async function* (): AsyncIterator<ChatCompletionChunk> {
		for await (const response of stream) {
			const chunk: ChatCompletionChunk = {
				id: 'id',
				choices: response.candidates.map(candidate => ({
					delta: {
						content: candidate?.content?.parts[0]?.text,
					},
					finish_reason: null,
					index: 0,
				})),
				created: Date.now() / 1000,
				model: 'gemini-pro',
				object: 'chat.completion.chunk',
			}
			yield chunk

			if (response.candidates[0].finishReason) {
				yield {
					id: 'id',
					choices: [{
						finish_reason: response.candidates[0].finishReason as any,
						index: 0,
						delta: {
							content: ' ',
						},
					}],
					created: Date.now() / 1000,
					model: 'gemini-pro',
					object: 'chat.completion.chunk',
				}
				return
			}
		}
	}

	return new Stream(iterator, controller)
}

export const convertConversationHistoryToVertexContent = (messages: ConversationHistory[]): Content[] => {
	const mergedMessages: Content[] = []
	messages.forEach((message, index) => {
		if (index === 0 || messages[index - 1].author !== message.author) {
			mergedMessages.push({
				role: message.author === 'ai' ? 'MODEL' : 'USER',
				parts: [{ text: message.text }],
			})
		} else {
			const lastMergedMessage = mergedMessages[mergedMessages.length - 1]
			lastMergedMessage.parts[0].text += `\n${message.text}`
		}
	})
	return mergedMessages
}
