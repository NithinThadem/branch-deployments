/* eslint-disable max-len */
import { Request, Response } from 'express'
import * as VoiceResponse from 'twilio/lib/twiml/VoiceResponse'
import logger from '../../../../util/logger.util'
import { uploadByUrl } from '../../../../services/google/storage'
import { twilioClientWithArgs } from '../../../../services/twilio'
import { captureError } from '../../../../util/error.util'
import { InterviewResponseEntity } from '../../../interview-response/db/interview-response.entity'
import { ContactEntity } from '../../../contact/db/contact.entity'
import { InterviewResponseStatus, InterviewResponseType } from '../../../interview-response/db/interview-response.types'
import { PhoneNumberEntity } from '../../../phone_number/db/phone_number.entity'
import { InterviewDeliverableEntity } from '../../../interview-deliverable/db/interview-deliverable.entity'
import { InterviewDeliverableType } from '../../../interview-deliverable/db/interview-deliverable.types'
import { generateInitialConversationHistory, onInterviewStart } from '../../../interview-response/api/interview-response.helpers'
import EventUtil from '../../../../services/event'
import { DataPointEntity } from '../../../data-point/db/data-point.entity'
import { DataPointType } from '../../../data-point/db/data-point.types'
import { TeamEntity } from '../../../team/db/team.entity'
import {
	onTwilioCustomerA2PBrandApproved, onTwilioCustomerA2PCampaignApproved,
	onTwilioCustomerA2PCampaignRejected, onTwilioCustomerProfileApproved, onTwilioCustomerProfileRejected, onTwilioShakenStirApproved, onTwilioShakenStirRejected, twilioCreateA2PBrand, submitShakenStir, twilioFetchA2PBrand,
	twilioFetchA2PCampaign,
} from '../../../../services/twilio/twilio.helpers'
import { withExponentialBackoff } from '../../../../util/helpers.util'
import { A2P_BRAND_STATUS, A2P_TRUST_BUNDLE_STATUS } from '../../../../modules/team/db/team.types'
import { getAndFireWebhooks } from '../../../webhook/db/webhook.helpers'
import { WebhookEventType } from '../../../webhook/db/webhook.types'
import { TwilioSmsMessage } from '../../../sms-message/db/sms-message.types'
import { SmsMessageEntity } from '../../../sms-message/db/sms-message.entity'
import { getTeamUserEmails } from '../../../../modules/team/api/team.helpers'
import { sendTransactionalEmail } from '../../../../services/email'
import { TransactionalEmail } from '../../../../services/email/emails.enums'
import { twilioSubmitA2PBundleAndBrand, twilioSubmitA2PCampaign } from '../../../../services/twilio/twilio.controller'
import { isProduction } from '../../../../util/env.util'
import { redisRead, redisWrite } from '../../../../services/redis'
import { CallerIdEntity } from '../../../caller-id/db/caller-id.entity'
import { InterviewEntity } from '../../../interview/db/interview.entity'
import { azureAi, AzureOpenAIModels } from '../../../../services/azure'
import { OpenAIModels } from '../../../../services/openai'
import analytics from '../../../../services/segment'

export const getTwilioTwiml = async (req: Request, res: Response) => {
	let responseSent = false
	let webhookSent = false

	const sendResponse = (content, contentType = 'text/xml') => {
		if (!responseSent) {
			res.type(contentType).send(content)
			responseSent = true
		}
	}

	const _onHangup = async () => {
		logger.info(`Ending Twilio call: ${req.body.CallSid}`)
		const twiml = new VoiceResponse()
		twiml.hangup()
		sendResponse(twiml.toString())

		let interviewResponse = await InterviewResponseEntity.findOne({
			where: { twilio_sid: req.body.CallSid },
			relations: ['interview'],
		})

		if (!interviewResponse) {
			interviewResponse = new InterviewResponseEntity()
			interviewResponse.twilio_sid = req.body.CallSid
			interviewResponse.status = InterviewResponseStatus.NO_ANSWER
			await interviewResponse.save()
			logger.info(`Created new interview response for SID: ${req.body.CallSid}`)
		}

		if (interviewResponse.interview && !webhookSent) {
			await getAndFireWebhooks(
				WebhookEventType.NEW_RESPONSE,
				interviewResponse.interview.id,
				interviewResponse.toPublic(),
			)
			webhookSent = true
		}
	}

	let answered_by = 'human'
	const twiml = new VoiceResponse()

	try {
		let interviewResponse: InterviewResponseEntity
		const newAgentConfig = JSON.parse(await redisRead(`agent-transfer-interview-${req.body.From}`))

		if (req.body.Direction.toLowerCase().indexOf('outbound') > -1 && !newAgentConfig) {
			logger.info(`Outbound Twilio call from ${req.body.From} to ${req.body.To}`)

			interviewResponse = await InterviewResponseEntity.findOne({
				where: { twilio_sid: req.body.CallSid },
				relations: ['team', 'interview', 'contact', 'contact.tags', 'job'],
			})

			if (!interviewResponse) {
				interviewResponse = new InterviewResponseEntity()
				interviewResponse.twilio_sid = req.body.CallSid
				interviewResponse.phone_number = req.body.To
				await interviewResponse.save()
			}

			if (req.body.AnsweredBy !== 'human') {
				answered_by = 'not-human'
				logger.debug(`Twilio call not answered by human: ${req.body.AnsweredBy}`)

				const shouldLeaveVoicemail = interviewResponse.conversation_history[1].voicemail_content && interviewResponse.conversation_history[1].voicemail_audio_url

				interviewResponse.status = InterviewResponseStatus.VOICEMAIL

				if (!shouldLeaveVoicemail) {
					await interviewResponse.save()

					twiml.hangup()
					return sendResponse(twiml.toString())
				}

				interviewResponse.conversation_history[1].text = interviewResponse.conversation_history[1].voicemail_content
				await interviewResponse.save()

				const statusDataPoint = DataPointEntity.create({
					response_id: interviewResponse.id,
					response_type: InterviewResponseType.PHONE_CALL,
					interview_id: interviewResponse.interview.id,
					team_id: interviewResponse.team.id,
					type: DataPointType.NO_ANSWER,
					value: interviewResponse.status,
				})
				await statusDataPoint.save()

				await getAndFireWebhooks(
					WebhookEventType.NEW_RESPONSE,
					interviewResponse.interview.id,
					interviewResponse.toPublic(),
				).catch(captureError)
				webhookSent = true

				logger.info(`Leaving voicemail for ${req.body.To} from URL: ${interviewResponse.conversation_history[1].voicemail_audio_url}`)
				twiml.play(interviewResponse.conversation_history[1].voicemail_audio_url)

				return sendResponse(twiml.toString())
			}
		} else if (newAgentConfig && newAgentConfig.new_interview_id && newAgentConfig.interview_response_id) {
			logger.info(`Agent transfer initiated for interview ${newAgentConfig.new_interview_id} from ${req.body.From} to ${req.body.To}`)

			const interviewResponse = await InterviewResponseEntity.findOneOrFail({
				where: { id: newAgentConfig.interview_response_id },
				relations: ['interview', 'team', 'interview.outbound_phone_number', 'interview.inbound_phone_number'],
			})

			const newInterview = await InterviewEntity.findOneOrFail({
				where: { id: newAgentConfig.new_interview_id },
				relations: ['outbound_phone_number', 'team', 'flow'],
			})

			const newConversationHistory = await generateInitialConversationHistory({
				interview: newInterview,
				format: 'ulaw_8000',
				contact: interviewResponse.contact,
				type: interviewResponse.type,
				metadata: interviewResponse.metadata,
			})

			const messagesContent = [
				JSON.stringify(interviewResponse.conversation_history, null, 2),
				'**Prompt***\n\nWhat index represents the AI\'s last response? Whichever Say message matches the closest will be the index to choose.\n\n**Prompt***',
			]

			const prompt = messagesContent.join('\n\n')

			const { choices } = await azureAi({
				'Helicone-Property-Feature': 'Agent Transfer Summary',
				'Helicone-Property-InterviewId': newInterview.id,
				'Helicone-Property-InterviewResponseId': interviewResponse.id,
				model: AzureOpenAIModels.GPT_4_O,
				team_id: interviewResponse.team.id,
			}).chat.completions.create({
				model: OpenAIModels.GPT_4_O,
				temperature: 0,
				messages: [
					{
						role: 'system',
						content: prompt,
					},
					{
						role: 'user',
						content: 'What is the sumarry of the conversation? Ensure to include key information obtained and what was talked about.',
					},
				],
			})

			const summary = choices[0].message.content

			const systemMessage = {
				date: new Date(),
				author: 'system' as const,
				text: `**This is a transfer from another agent, here is the previous agent call summary**\n\n${summary}`,
			}

			// Find the index of the first AI message
			const firstAIMessageIndex = newConversationHistory.findIndex(message => message.author === 'ai')

			if (firstAIMessageIndex !== -1) {
				newConversationHistory.splice(firstAIMessageIndex, 0, systemMessage)
			} else {
				newConversationHistory.push(systemMessage)
			}

			const newInterviewResponse = await onInterviewStart({
				twilio_sid: req.body.CallSid,
				team: interviewResponse.team,
				interview: newInterview,
				type: InterviewResponseType.AGENT_TRANSFER,
				contact: interviewResponse.contact,
				conversationHistory: newConversationHistory,
				direction: 'inbound',
			})

			logger.info(`New response created for agent transfer: ${newInterviewResponse.id} from ${req.body.From} to ${req.body.To}`)
			const twiml = new VoiceResponse()

			const data: Record<string, string> = {
				to: req.body.To,
				from: req.body.From,
			}
			if (!responseSent) {
				twiml.connect().stream({
					url: `wss://${req.headers.host}/twilio`,
				}).addChild('Parameter', {
					name: 'Data',
					value: JSON.stringify(data),
				})

				sendResponse(twiml.toString())
			}

			logger.info('Connected agent transfer call to new agent')
		} else {
			logger.info(`Inbound Twilio call from ${req.body.From} to ${req.body.To}`)

			const [
				phoneNumber,
				contact,
			] = await Promise.all([
				PhoneNumberEntity.findOne({
					where: {
						phone_number: req.body.To,
					},
					relations: ['inbound_interview.team', 'inbound_interview', 'inbound_interview.flow'],
				}),
				ContactEntity.findOne({
					where: {
						phone_number: req.body.From,
					},
				}),
			])

			if (!phoneNumber) {
				logger.warn(`No phone number found for: ${req.body.To}`)
				return _onHangup()
			}

			if (!phoneNumber?.inbound_interview) {
				logger.warn(`No interview found for phone number: ${req.body.To}`)
				return _onHangup()
			}

			interviewResponse = await onInterviewStart({
				twilio_sid: req.body.CallSid,
				team: phoneNumber.inbound_interview.team,
				interview: phoneNumber.inbound_interview,
				type: InterviewResponseType.INBOUND_CALL,
				contact,
				direction: 'inbound',
			})
		}

		if (!responseSent) {
			let data: Record<string, string> = {
				to: req.body.To,
				from: req.body.From,
			}

			if (interviewResponse) {
				data = {
					...data,
					interview_response_id: interviewResponse.id,
					answered_by,
				}
			}

			twiml.connect().stream({
				url: `wss://${req.headers.host}/twilio`,
			}).addChild('Parameter', {
				name: 'Data',
				value: JSON.stringify(data),
			})

			sendResponse(twiml.toString())
		}
	} catch (error) {
		captureError(error)
		_onHangup()
	}
}

export const onTwilioStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio status callback: ${JSON.stringify(req.body, null, 2)}`)

	const _getMetricBody = (response: InterviewResponseEntity) => ({
		team_name: response.team.name,
		ai_name: response.interview.ai_name,
		used_genius: !!response.interview.genius_id,
		lang: response.interview.lang,
		presence_background_audio: response.interview.presence_background_audio,
		presence_interim_audio: response.interview.presence_interim_audio,
		should_leave_voicemail: response.interview.should_leave_voicemail,
		should_record: response.interview.should_record,
		title: response.interview.title,
		type: response.interview.type,
		status: response.status,
		triggered_by: response.triggered_metadata?.triggered_by,
		...req.body,
	})

	if (req.body.CallStatus === 'in-progress') {
		const response = await InterviewResponseEntity.findOne({
			where: { twilio_sid: req.body.CallSid },
			relations: ['interview', 'team'],
		})

		if (response.interview.should_record) {
			logger.info(`[${response.id}] Started recording call`)
			await twilioClientWithArgs({
				accountSid: req.body.AccountSid,
			}).calls(req.body.CallSid).recordings.create({
				trim: 'trim-silence',
				recordingChannels: 'mono',
				recordingTrack: 'both',
				recordingStatusCallback: `https://${process.env.API_URL}/webhook/twilio/recording`,
				recordingStatusCallbackEvent: ['in-progress', 'completed'],
			}).catch(captureError)
		} else {
			logger.info(`[${response.id}] Not recording call`)
		}

		await analytics.event('Call Initiated', _getMetricBody(response))
	}

	if (req.body.CallStatus === 'completed') {
		const response = await InterviewResponseEntity.findOne({
			where: { twilio_sid: req.body.CallSid },
			relations: ['interview', 'team'],
		})

		if (response) {
			// Update the duration of the call if it's longer than the current duration
			// If the call goes to voicemail, duration_ms will be 0, so Twilio's duration will be used
			response.metadata = {
				...response.metadata,
				twilio_call_time_ms: req.body.CallDuration * 1000,
			}
			// response.duration_ms = Math.max(req.body.CallDuration * 1000, response.duration_ms)
			await response.save()
		} else {
			logger.warn(`No response found for completed call SID: ${req.body.CallSid}`)
		}

		await analytics.event('Call Completed', _getMetricBody(response))
	}

	if (req.body.CallStatus === 'failed') {
		const existingInterviewResponse = await InterviewResponseEntity.findOne({
			where: { twilio_sid: req.body.CallSid },
			relations: ['job', 'interview'],
		})

		if (!existingInterviewResponse) {
			logger.info(`No existing response for failed call SID: ${req.body.CallSid}. Creating new response.`)
			const newInterviewResponse = new InterviewResponseEntity()
			newInterviewResponse.twilio_sid = req.body.CallSid
			newInterviewResponse.status = InterviewResponseStatus.FAILED
			await newInterviewResponse.save()

			await getAndFireWebhooks(
				WebhookEventType.NEW_RESPONSE,
				newInterviewResponse.interview.id,
				newInterviewResponse.toPublic(),
			).catch(captureError)
		} else {
			existingInterviewResponse.status = InterviewResponseStatus.FAILED
			await existingInterviewResponse.save()

			await getAndFireWebhooks(
				WebhookEventType.NEW_RESPONSE,
				existingInterviewResponse.interview.id,
				existingInterviewResponse.toPublic(),
			).catch(captureError)
		}
	}

	await analytics.event('Twilio Call Status Callback', req.body)

	res.send()
}

export const onTwilioAmdStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio AMD callback: ${JSON.stringify(req.body, null, 2)}`)

	res.send()
}

const _stopRecordings = async (callSID: string, subaccountId?: string) => {
	try {
		const recordings = await twilioClientWithArgs({
			accountSid: subaccountId,
		}).calls(callSID).recordings.list()

		if (recordings && recordings.length > 0) {
			await Promise.all(recordings.map((recording) =>
				twilioClientWithArgs({
					accountSid: subaccountId,
				}).calls(callSID).recordings(recording.sid).update({
					status: 'stopped',
				})
			))
			return `Recordings for call ${callSID} stopped successfully`
		}
	} catch (error) {
		return Promise.reject(error)
	}
}

export const onTwilioTransferStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio transfer status callback: ${req.body.CallStatus}`)
	const parentCallSid = req.body.ParentCallSid

	await withExponentialBackoff(() =>
		_stopRecordings(parentCallSid, req.body.AccountSid)
			.then((message) => message && logger.debug(message))
			.catch((error) =>
				logger.error('Error stopping recordings:', error)
			)
	)

	res.send()
}

export const onTwilioRecording = async (req: Request, res: Response) => {
	if (req.body.RecordingStatus !== 'completed') {
		logger.debug(`Twilio recording status callback: ${JSON.stringify(req.body, null, 2)}`)
		return res.send()
	}

	let interviewResponseId: string
	let interviewResponse: InterviewResponseEntity

	try {
		interviewResponse = await InterviewResponseEntity.findOneOrFail({
			where: {
				twilio_sid: req.body.CallSid,
			},
			relations: ['job', 'contact', 'team'],
		})

		const call = await withExponentialBackoff(async () => await twilioClientWithArgs({
			accountSid: req.body.AccountSid,
		}).calls(req.body.CallSid).fetch())

		const callType = call.direction === 'inbound' ? 'from' : 'to'
		const caller = call[callType]

		interviewResponseId = interviewResponse.id

		const recording_url = await uploadByUrl(req.body.RecordingUrl, 'mp3', {
			headers: {
				'Content-Type': 'audio/mpeg',
			},
			auth: {
				username: process.env.TWILIO_ACCOUNT_SID,
				password: process.env.TWILIO_AUTH_TOKEN,
			},
		})

		interviewResponse.recording_url = recording_url
		await interviewResponse.save()

		await InterviewDeliverableEntity.create({
			interview_response: { id: interviewResponse.id },
			type: InterviewDeliverableType.PHONE_CALL_RECORDING,
			audio_url: recording_url,
			length_seconds: req.body.RecordingDuration,
		}).save()

		if (!interviewResponse.contact) {
			if (interviewResponse.job) {
				await interviewResponse.job.appendLog(`[${caller}]: creating contact for respondent`)
			}

			const existing = await ContactEntity.findOne({
				where: [
					{ phone_number: caller },
				],
			})

			if (existing) {
				interviewResponse.contact = existing
				existing.jobs?.push(interviewResponse.job)
				await interviewResponse.save()
			} else {
				const lookup = await withExponentialBackoff(async () => await twilioClientWithArgs({
					accountSid: req.body.AccountSid,
				}).lookups.v2.phoneNumbers(caller).fetch({
					fields: 'caller_name',
				}).catch(error => {
					captureError(error)
					return null
				}))

				const contact = await ContactEntity.create({
					team: { id: interviewResponse.team.id },
					name: lookup?.callerName.caller_name,
					caller_type: lookup?.callerName.caller_type,
					phone_number: caller,
					jobs: [interviewResponse.job],
				}).save().catch(captureError)

				if (typeof contact !== 'string') {
					interviewResponse.contact = contact
					await interviewResponse.save()
				}
			}
		} else {
			logger.debug(`Contact already exists for ${caller}`)
		}

		if (interviewResponse.job) {
			await interviewResponse.job.appendLog(
				`[${caller}]: recording saved to ${recording_url}`
			)
		}
	} catch (error) {
		captureError(error)
	}

	await withExponentialBackoff(async () => {
		await twilioClientWithArgs({
			accountSid: req.body.AccountSid,
		}).recordings(req.body.RecordingSid).remove()
	})

	if (interviewResponseId && interviewResponse.status !== InterviewResponseStatus.VOICEMAIL) {
		await EventUtil.asyncEmit('INTERVIEW_END', {
			interview_response_id: interviewResponseId,
		})
	}

	res.send()
}

export const onTwilioCustomerProfileStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio customer profile status callback: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body as {
		AccountSid: string
		BundleSid: string
		Status: string
		FailureReason: string
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.AccountSid,
		},
		relations: ['phone_numbers'],
	})

	logger.debug(`Updating Twilio customer profile status for team ${team.name} to ${body.Status}`)

	team.twilio_metadata.twilio_customer_profile_status = body.Status
	await team.save()

	/* a precaution for twilio bug that fires same webhook event multiple times with same req.body */
	const redisLockKey = `team:${body.Status}:twilio-migration-lock`

	const redisLock = await redisRead(redisLockKey)

	if (body.Status === 'pending-review' || body.Status === 'in-review') {
		/* if customer profile is already in review, just return */
		if (redisLock) {
			logger.info(`Customer profile ${body.BundleSid} is already in review, returning...`)
			res.send()
			return
		}

		await redisWrite(redisLockKey, 'true', { EX: 60 })

		/* After customer profile is submitted, also submit the brand and bundle */
		/* Once brand is approved we submit a2p campaign for review automatically */
		/* Only submit if brand and bundle is not submitted yet! (check: https://thoughtly.sentry.io/issues/5423270747/events/31ff6e23350c475d80e634c4fa1975e2/?project=4505699564126208) */
		if ((!team.twilio_metadata.twilio_customer_a2p_bundle_status || team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.DRAFT) &&
			(!team.twilio_metadata.twilio_customer_a2p_brand_status || team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.DRAFT)) {
			await twilioSubmitA2PBundleAndBrand({
				team,
				isMock: !isProduction(),
			})
		}
	}

	if (body.Status === 'twilio-approved') {
		team.twilio_metadata.twilio_customer_profile_failure_reason = ''
		await team.save()

		/* send business approved emails */
		await onTwilioCustomerProfileApproved(team)

		/* submit shaken stir */
		await submitShakenStir(team)
	}

	if (body.Status === 'twilio-rejected') {
		team.twilio_metadata.twilio_customer_profile_failure_reason = body.FailureReason
		await team.save()

		await onTwilioCustomerProfileRejected(team, body.FailureReason)
	}

	res.send()
}

export const onTwilioCustomerA2PBundleStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio customer a2p bundle status callback: ${JSON.stringify(req.body, null, 2)}`)

	/* check: https://www.twilio.com/docs/phone-numbers/regulatory/api/bundles#status-callback */
	const body = req.body as {
		AccountSid: string
		BundleSid: string
		Status: string
		FailureReason: string
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.AccountSid,
		},
		relations: ['phone_numbers'],
	})

	team.twilio_metadata.twilio_customer_a2p_bundle_failure_reason = ''
	await team.save()

	const redisLockKey = `team:${team.name}:twilio-bundle-lock`

	const redisLock = await redisRead(redisLockKey)

	if (redisLock) {
		logger.info(`Webhook for bundle status has fired with in-review status again! for team ${team.name}`)
	}

	if (body.Status === 'in-review' && !redisLock) {
		await redisWrite(redisLockKey, 'true', { EX: 60 })
		logger.info(`Submitting A2P Brand for team ${team.name}`)

		/* submit the brand once the bundle is in review */
		const brandSid = await twilioCreateA2PBrand({
			team,
			a2PProfileBundleSid: team.twilio_metadata.twilio_customer_bundle_sid || body.BundleSid,
			customerProfileBundleSid: team.twilio_metadata.twilio_customer_profile_sid,
			isMock: !isProduction(),
		})

		logger.info(`Submitted A2P Brand for team ${team.name}, mock: ${!isProduction()}, sid: ${brandSid}`)
	}

	if (body.Status === 'twilio-approved') {
		// nothing to do here, but keeping this if block in case if we need it
	}

	if (body.Status === 'twilio-rejected') {
		team.twilio_metadata.twilio_customer_a2p_bundle_failure_reason = body.FailureReason
		await team.save()
	}

	logger.debug(`Updating Twilio customer a2p bundle status for team ${team.name} to ${body.Status}`)

	team.twilio_metadata.twilio_customer_a2p_bundle_status = body.Status
	await team.save()

	res.send()
}

export const onTwilioShakenStirStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio shaken/stir status callback: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body as {
		AccountSid: string
		BundleSid: string
		Status: string
		FailureReason: string
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.AccountSid,
		},
		relations: ['phone_numbers'],
	})

	logger.debug(`Updating Twilio customer shaken/stir status for team ${team.name} to ${body.Status}`)

	team.twilio_metadata.twilio_customer_shaken_stir_failure_reason = ''
	team.twilio_metadata.twilio_shaken_stir_status = body.Status
	await team.save()

	if (body.Status === 'twilio-approved') {
		await onTwilioShakenStirApproved(team)
	}

	if (body.Status === 'twilio-rejected') {
		team.twilio_metadata.twilio_customer_shaken_stir_failure_reason = body.FailureReason
		await team.save()
		await onTwilioShakenStirRejected(team, body.FailureReason)
	}

	res.send()
}

export const onTwilioA2PCampaignOrBrandStatusCallback = async (req: Request, res: Response) => {
	logger.debug(`Twilio customer a2p brand or campaign status callback: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body[0] as {
		data: {
			accountsid: string
			brandsid: string
			brandstatus: string
			identitystatus: string
			campaignregistrationstatus?: undefined
			messagingservicesid?: undefined
		} | {
			accountsid: string
			brandsid: string
			campaignregistrationstatus: string
			messagingservicesid: string
			brandstatus?: undefined
			identitystatus?: undefined
		}
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.data.accountsid,
		},
		relations: ['phone_numbers'],
	})

	if (body.data.brandsid) {
		team.twilio_metadata.twilio_customer_brand_registration_sid = body.data.brandsid
	}

	team.twilio_metadata.twilio_customer_a2p_brand_failure_reason = ''
	team.twilio_metadata.twilio_customer_a2p_campaign_failure_reason = []
	await team.save()

	if (body.data.brandstatus === 'registered' && body.data.identitystatus === 'verified') {
		logger.info(`A2P Brand is approved for team ${team.name}`)
		team.twilio_metadata.twilio_customer_a2p_brand_status = A2P_BRAND_STATUS.APPROVED
		await team.save()

		await onTwilioCustomerA2PBrandApproved(team)

		// submit a2p campaign once brand is approved
		logger.info(`A2P Brand is approved, now submitting the campaign for team ${team.name}`)
		await twilioSubmitA2PCampaign(team)
	} else if (body.data.brandstatus === 'registered') {
		if (team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.APPROVED ||
			team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.REGISTERED) {
			/* brand is already submitted or approved, just return */
			logger.info(`Brand ${body.data.brandsid} is already submitted or approved, so returning...`)
			res.send()
			return
		}

		team.twilio_metadata.twilio_customer_a2p_brand_status = A2P_BRAND_STATUS.REGISTERED
		await team.save()

		/* user submitted the brand for review, send emails  */
		try {
			const teamMemberEmails = await getTeamUserEmails(team.id)

			for (const email of teamMemberEmails) {
				await sendTransactionalEmail({
					email,
					type: TransactionalEmail.BRAND_SUBMITTED,
					data: {
						team_name: team.name,
					},
				})
			}
		} catch (error) {
			captureError(error)
		}

		logger.info('Brand submitted email sent')
	}

	if (body.data.brandstatus === 'registration_failed') {
		const { failureReason } = await twilioFetchA2PBrand({
			brandRegistrationSid: team.twilio_metadata.twilio_customer_brand_registration_sid,
			team,
		})
		team.twilio_metadata.twilio_customer_a2p_brand_failure_reason = failureReason
		await team.save()
	}

	if (body.data.campaignregistrationstatus === 'success') {
		team.twilio_metadata.twilio_customer_a2p_campaign_failure_reason = []
		await team.save()

		await onTwilioCustomerA2PCampaignApproved(team)
	}

	if (body.data.campaignregistrationstatus === 'failure') {
		try {
			/* const reason = 'Please check the twilio console to fix the campaign errors.' */
			let errors = []
			// fetch campaign to see errors array
			const campaign = await twilioFetchA2PCampaign({
				messagingServiceSid: body.data.messagingservicesid || team.twilio_metadata.twilio_customer_messaging_service_sid,
				team,
			})

			if (campaign && campaign.errors) {
				errors = campaign.errors.map(err => err?.description)
			}

			team.twilio_metadata.twilio_customer_a2p_campaign_failure_reason = errors
			await team.save()

			onTwilioCustomerA2PCampaignRejected(team, errors)
		} catch (error) {
			captureError(error)
			logger.error(`Error while fetching the campaign or sending campaing_failed emails for team: ${team.name}, error: ${error}`)
		}
	}

	if (body.data.brandstatus) {
		logger.info(`Updating Twilio customer a2p brand status for team ${team.name} to ${body.data.brandstatus}`)
		team.twilio_metadata.twilio_customer_a2p_brand_status = body.data.brandstatus
	} else if (body.data.campaignregistrationstatus) {
		logger.info(`Updating Twilio customer a2p campaign status for team ${team.name} to ${body.data.campaignregistrationstatus}`)
		team.twilio_metadata.twilio_customer_a2p_campaign_status = body.data.campaignregistrationstatus
	}

	await team.save()

	res.send()
}

export const onTwilioCnamStatus = async (req: Request, res: Response) => {
	logger.debug(`Twilio CNAM status callback: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body as {
		AccountSid: string
		PhoneNumberSid: string
		Status: string
		FailureReason: string
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.AccountSid,
		},
		relations: ['phone_numbers'],
	})

	team.twilio_metadata.twilio_cnam_trust_product_status = body.Status
	await team.save()

	res.send()
}

export const onTwilioSms = async (req: Request, res: Response) => {
	logger.debug(`Twilio SMS message: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body as TwilioSmsMessage

	const [
		existingMessage,
		phoneNumber,
	] = await Promise.all([
		SmsMessageEntity.findOne({
			where: {
				twilio_sid: body.SmsSid,
			},
		}),
		PhoneNumberEntity.findOne({
			where: {
				phone_number: req.body.To,
			},
			relations: ['team'],
		}),
	])

	if (!phoneNumber) {
		logger.warn(`SMS: no phone number found for: ${req.body.To}`)
		return res.send()
	}

	let message: SmsMessageEntity

	if (existingMessage) {
		message = existingMessage
	} else {
		message = await SmsMessageEntity.create()
	}

	message.twilio_sid = body.SmsSid
	message.status = body.SmsStatus
	message.body = body.Body
	message.from = body.From
	message.to = body.To
	message.twilio_metadata = body

	message.team = phoneNumber.team
	message.phone_number = phoneNumber

	await message.save()

	logger.debug(`SMS message to team ${phoneNumber.team.name} saved: ${message.body}`)

	res.send()
}

export const onTwilioCallerIdVerification = async (req: Request, res: Response) => {
	logger.debug(`Twilio caller id verification: ${JSON.stringify(req.body, null, 2)}`)

	const body = req.body as {
		AccountSid: string
		VerificationStatus: string
		OutgoingCallerIdSid: string
		CallSid: string
		To: string
	}

	const team = await TeamEntity.findOneOrFail({
		where: {
			twilio_account_sid: body.AccountSid,
		},
	})

	if (body.VerificationStatus === 'success') {
		await CallerIdEntity.create({
			team,
			phone_number: body.To,
			twilio_sid: body.OutgoingCallerIdSid,
		}).save()
	}

	logger.info(`Caller ID verification for team ${team.name} saved: ${body.To} - ${body.VerificationStatus}`)

	res.send()
}
