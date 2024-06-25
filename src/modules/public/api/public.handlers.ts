import { Request, Response } from 'express'
import response from '../../../services/server/response'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import logger from '../../../util/logger.util'
import { generateSignedUploadUrl, uploadFile } from '../../../services/google/storage'
import { captureError } from '../../../util/error.util'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { synthesizeSpeech } from '../../interview/api/interview.helpers'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { InterviewResponseStatus, InterviewResponseType } from '../../interview-response/db/interview-response.types'
import { ContactEntity } from '../../contact/db/contact.entity'
import {
	generateInitialConversationHistory,
	onInterviewEnd,
	onInterviewStart,
} from '../../interview-response/api/interview-response.helpers'

export const startResponse = async (req: Request, res: Response) => {
	let interviewResponse: InterviewResponseEntity

	if (req.body.interview_response_id) {
		interviewResponse = await InterviewResponseEntity.findOne({
			where: {
				id: req.body.interview_response_id,
			},
			relations: ['interview', 'interview.team'],
		})
	}

	if (!interviewResponse) {
		const interview = await InterviewEntity.findOneOrFail({
			where: {
				id: req.params.interview_id,
			},
			relations: ['team', 'flow'],
		})

		let contact
		if (req.body.email && req.body.first_name && req.body.last_name) {
			contact = await ContactEntity.findOne({
				where: {
					team_id: interview.team_id,
					email: req.body.email.toLowerCase(),
				},
			})

			if (!contact) {
				contact = await ContactEntity.create({
					team: { id: interview.team_id },
					name: `${req.body.first_name} ${req.body.last_name}`,
					email: req.body.email.toLowerCase(),
				}).save()
			}
		} else {
			contact = await ContactEntity.create({
				team: { id: interview.team_id },
			}).save()
		}

		let interviewType = InterviewResponseType.BROWSER_CALL

		if (req.body.type) {
			switch (req.body.type) {
				case 'BROWSER_TEXT':
					interviewType = InterviewResponseType.BROWSER_TEXT
					break
				case 'WIDGET':
					interviewType = InterviewResponseType.WIDGET
					break
				default:
					break
			}
		}

		interviewResponse = await onInterviewStart({
			type: interviewType,
			interview,
			contact,
			team: interview.team,
			format: 'mp3_44100',
			triggered_metadata: req.triggered_metadata,
			direction: 'outbound',
		})
	}

	interviewResponse.status = InterviewResponseStatus.IN_PROGRESS
	await interviewResponse.save()

	if (interviewResponse.conversation_history.length) {
		return response({ res, data: interviewResponse })
	}

	interviewResponse.conversation_history = await generateInitialConversationHistory({
		interview: interviewResponse.interview,
		format: 'mp3_44100',
		contact: interviewResponse.contact,
	})
	interviewResponse.status = InterviewResponseStatus.IN_PROGRESS
	interviewResponse.start_time = new Date()
	await interviewResponse.save()

	return response({ res, data: interviewResponse })
}

export const uploadSegment = async (req: Request, res: Response) => {
	try {
		const interviewResponse = await InterviewResponseEntity.findOneOrFail({
			where: {
				id: req.params.interview_response_id,
			},
		})

		if (interviewResponse.status !== InterviewResponseStatus.IN_PROGRESS) {
			return response({ res, error: 'Interview is not in progress' })
		}

		const { signedUrl, uploadedUrl } = await generateSignedUploadUrl('webm', 'video/webm')

		res.write(JSON.stringify({
			signedUrl,
		}) + '\n')

		const cumulative_duration_ms = interviewResponse.conversation_history[
			interviewResponse.conversation_history.length - 1
		].cumulative_duration_ms + req.body.cumulative_duration_ms

		interviewResponse.conversation_history.push({
			date: new Date(),
			author: 'user',
			text: req.body.transcript,
			video_url: uploadedUrl,
			cumulative_duration_ms,
		})

		logger.debug(`Running AI response to transcript: ${req.body.transcript}`)

		const { choices } = await azureAi({ model: AzureOpenAIModels.GPT_3_5_TURBO_16K }).chat.completions.create({
			model: OpenAIModels.GPT_3_5_TURBO_16K,
			temperature: 0.9,
			messages: interviewResponse.conversation_history.map((message) => ({
				role: message.author === 'ai' ? 'assistant' : message.author,
				content: message.text,
			})),
		})

		let aiResponse = choices[0].message.content
		aiResponse = aiResponse.replace(`${interviewResponse.ai_name}:`, '')

		logger.debug(`Synthesizing AI response: ${aiResponse}`)

		const audioContent = await synthesizeSpeech(aiResponse, interviewResponse.ai_name)

		interviewResponse.conversation_history.push({
			date: new Date(),
			author: 'ai',
			text: aiResponse,
			cumulative_duration_ms,
		})

		res.write(JSON.stringify({
			interviewResponse,
			audio: audioContent,
		}) + '\n')

		const aiAudioFileUrl = await uploadFile('mp3', audioContent)

		interviewResponse.conversation_history[interviewResponse.conversation_history.length - 1].audio_url = aiAudioFileUrl

		logger.debug('Saving interview')

		await interviewResponse.save()

		res.end()
	} catch (error) {
		captureError(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const markResponseEnded = async (req: Request, res: Response) => {
	try {
		const { userEnded, reason } = req.body

		const interviewResponse = await InterviewResponseEntity.findOneOrFail({
			where: {
				id: req.params.interview_response_id,
			},
			relations: ['interview', 'team'],
		})
		await onInterviewEnd(interviewResponse, undefined, userEnded, reason)

		return response({ res, data: { message: 'Interview marked as ended and processing started' } })
	} catch (error) {
		captureError(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getInterview = async (req: Request, res: Response) => {
	const data = await InterviewEntity.findOne({
		where: {
			id: req.params.interview_id,
		},
		relations: ['team'],
	})

	return response({ res, data })
}

export const getResponse = async (req: Request, res: Response) => {
	const data = await InterviewResponseEntity.findOne({
		where: {
			id: req.params.interview_response_id,
		},
		relations: ['interview', 'interview.team'],
	})

	return response({ res, data })
}
