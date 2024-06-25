/* eslint-disable max-len */
import { EventMap } from '../event.map'
import logger from '../../../util/logger.util'
import { InterviewDeliverableEntity } from '../../../modules/interview-deliverable/db/interview-deliverable.entity'
import { InterviewDeliverableType } from '../../../modules/interview-deliverable/db/interview-deliverable.types'
import { mergeVideoSegments, prepareTagForComparison } from '../../../modules/interview/api/interview.helpers'
import { InterviewResponseEntity } from '../../../modules/interview-response/db/interview-response.entity'
import { getTeamUserEmails } from '../../../modules/team/api/team.helpers'
import { sendTransactionalEmail } from '../../../services/email'
import { TransactionalEmail } from '../../../services/email/emails.enums'
import { captureError } from '../../../util/error.util'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { formatTagsAsBulletPoints } from '../../../util/helpers.util'
import validator from 'validator'
import { getClosestAvailableTimeToDate, launchCalendlyPage, scheduleTime } from '../../calendly'
import EventUtil from '..'
import { formatTranscript, getPostInterviewAnalysis } from '../../../modules/interview-response/api/interview-response.helpers'
import { ContactEntity } from '../../../modules/contact/db/contact.entity'
import { DataPointEntity } from '../../../modules/data-point/db/data-point.entity'
import { DataPointType } from '../../../modules/data-point/db/data-point.types'
import * as moment from 'moment'
import { ContactStatus } from '../../../modules/contact/db/contact.types'
import { getAndFireWebhooks } from '../../../modules/webhook/db/webhook.helpers'
import { WebhookEventType } from '../../../modules/webhook/db/webhook.types'
import { InterviewResponseMetadata } from '../../../modules/interview-response/db/interview-response.types'
import { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources'
import ghl, { GHLContact } from '../../../services/ghl'
import { IntegrationEntity } from '../../../modules/integration/db/integration.entity'
import analytics from '../../../services/segment'
import { InterviewFunctionName } from '../../../modules/interview-flow/db/interview-flow.types'

const onInterviewEnd = async ({ interview_response_id }: EventMap['INTERVIEW_END']) => {
	let interviewResponse = await InterviewResponseEntity.findOne({
		where: { id: interview_response_id },
		relations: ['interview', 'contact', 'interview.flow', 'team'],
	})

	if (!interviewResponse) {
		logger.error(`Response ${interview_response_id} not found.`)
		return
	}

	let thumbnailUrl: string
	let tags = ''

	// Merge video segments

	try {
		const videoSegments = interviewResponse.conversation_history.filter(entry => entry.video_url)

		if (videoSegments.length > 0) {
			const mergeResult = await mergeVideoSegments(videoSegments)
			thumbnailUrl = mergeResult.thumbnailUrl

			await InterviewDeliverableEntity.create({
				interview_response: interviewResponse,
				type: InterviewDeliverableType.VIDEO,
				video_url: mergeResult.mergedVideoUrl,
				thumbnail_url: thumbnailUrl,
			}).save()

			logger.info(`Merged video segments for interview response ${interview_response_id}`)
		} else {
			logger.info(`No video segments to merge for interview response ${interview_response_id}`)
		}
	} catch (error) {
		captureError(error)
	}

	// Analyze interview response

	try {
		logger.info(`Analyzing interview response ${interview_response_id}`)

		const analysisResults: { summary?: string, name?: string, email?: string, dnc?: boolean, tags: string[] } = await getPostInterviewAnalysis(interview_response_id)

		if (analysisResults) {
			try {
				analytics.track({
					userId: 'system',
					event: 'Interview Response Analyzed',
					properties: {
						summary: analysisResults.summary,
						name: analysisResults.name,
						email: analysisResults.email,
						dnc: analysisResults.dnc,
						tags: analysisResults.tags,
					},
				})
			} catch (error) {
				captureError(error)
			}

			const expectedTagsPrepared = interviewResponse.interview.response_tags.map(prepareTagForComparison)
			const validTags = analysisResults.tags
				.map((tag: string) => {
					const preparedTag = prepareTagForComparison(tag)
					const index = expectedTagsPrepared.findIndex(expectedTag => expectedTag === preparedTag)
					return index !== -1 ? interviewResponse.interview.response_tags[index] : null
				})
				.filter((tag: null) => tag !== null)

			if (analysisResults.dnc && !validTags.includes('DNC')) {
				validTags.push('DNC')
			}

			const update = {
				summary_data: {
					summary: analysisResults.summary || '',
					response_tags: validTags,
				},
			}

			const contact = await ContactEntity.findOne({
				where: { id: interviewResponse.contact.id },
			})
			if (analysisResults.name !== 'N/A' && analysisResults.name?.length > 3) {
				if (contact.name === null) {
					contact.name = analysisResults.name
				}
			}

			if (analysisResults.email && analysisResults.email !== 'N/A') {
				if (validator.isEmail(analysisResults.email) && contact.email === null) {
					contact.email = analysisResults.email
				} else {
					logger.warn(`Invalid email address: ${analysisResults.email}`)
				}
			}

			if (analysisResults.dnc) {
				contact.status = ContactStatus.DNC
			} else {
				contact.status = ContactStatus.ACTIVE
			}

			await Promise.all([
				ContactEntity.update({ id: interviewResponse.contact.id }, contact),
				InterviewResponseEntity.update({ id: interview_response_id }, update),
			])
			if (validTags.length > 0) {
				tags = formatTagsAsBulletPoints(validTags)
			}
			interviewResponse.contact = contact
		} else {
			logger.warn(`No analysis results available for interview response ${interview_response_id}.`)
		}

		logger.info(`Sending emails for interview response ${interview_response_id}`)

		if (interviewResponse.interview.notifications) {
			const teamId = interviewResponse.interview.team_id
			const teamMemberEmails = await getTeamUserEmails(teamId)
			await Promise.all(teamMemberEmails.map(email => {
				const emailType = thumbnailUrl ? TransactionalEmail.NEW_RESPONSE_VIDEO : TransactionalEmail.NEW_RESPONSE_PHONE

				let dataVariables

				if (emailType === TransactionalEmail.NEW_RESPONSE_VIDEO) {
					dataVariables = {
						thumbnail1: thumbnailUrl,
						interview_id: interviewResponse.interview.id,
						interview_response_id: interview_response_id,
						summary: analysisResults.summary,
						name: interviewResponse.contact && interviewResponse.contact.name ? interviewResponse.contact.name : 'N/A',
						phone_number: interviewResponse.contact?.phone_number
							? `<a href="tel:${interviewResponse.contact.phone_number}">${interviewResponse.contact.phone_number}</a>`
							: 'N/A',
						email: interviewResponse.contact && interviewResponse.contact.email ? interviewResponse.contact.email : 'N/A',
						tags: tags || 'N/A',
					}
				} else {
					dataVariables = {
						interview_id: interviewResponse.interview.id,
						interview_response_id: interview_response_id,
						summary: analysisResults.summary,
						name: interviewResponse.contact && interviewResponse.contact.name ? interviewResponse.contact.name : 'N/A',
						phone_number: interviewResponse.contact?.phone_number
							? `<a href="tel:${interviewResponse.contact.phone_number}">${interviewResponse.contact.phone_number}</a>`
							: 'N/A',
						email: interviewResponse.contact && interviewResponse.contact.email ? interviewResponse.contact.email : 'N/A',
						tags: tags || 'N/A',
					}
				}
				logger.debug(`Email data being sent: ${JSON.stringify(dataVariables)}`)

				return sendTransactionalEmail({
					email: email,
					type: emailType,
					data: dataVariables,
				})
			}))
		} else {
			logger.info(`Notifications are disabled for interview ${interviewResponse.interview.id}. No emails sent.`)
		}
	} catch (error) {
		captureError(error)
	}

	// Gather data points

	logger.info(`Gathering data points for interview response ${interview_response_id}`)

	// Run post-call integrations

	try {
		interviewResponse = await InterviewResponseEntity.findOne({
			where: { id: interview_response_id },
			relations: ['interview', 'contact', 'contact.tags', 'interview.flow', 'team', 'job'],
		})

		const calendlyFunction = interviewResponse.interview.flow.functions.find((fn) => fn.name === InterviewFunctionName.CALENDLY)
		const ghlFunction = interviewResponse.interview.flow.functions.find((fn) => fn.name === InterviewFunctionName.HIGHLEVEL)
		const usesCalendly = interviewResponse.interview.flow.nodes.some((node) => String(node.data.function) === InterviewFunctionName.CALENDLY)
		const usesGhl = interviewResponse.interview.flow.nodes.some((node) => String(node.data.function) === InterviewFunctionName.HIGHLEVEL)

		if (usesCalendly && calendlyFunction) {
			logger.info(`Emitting INTERVIEW_SCHEDULE_CALENDLY_EVENT for interview response ${interview_response_id}`)
			await EventUtil.asyncEmit('INTERVIEW_SCHEDULE_CALENDLY_EVENT', { interview_response_id })
		} else if (usesGhl && ghlFunction) {
			logger.info(`Emitting INTERVIEW_SCHEDULE_GHL_EVENT for interview response ${interview_response_id}`)
			await EventUtil.asyncEmit('INTERVIEW_SCHEDULE_GHL_EVENT', { interview_response_id })
		} else {
			const dataPoints = await DataPointEntity.find({
				where: {
					response_id: interview_response_id,
					type: DataPointType.QUESTION_NODE,
				},
			})

			const simplifiedDataPoints = dataPoints.map(dataPoint => ({
				title: dataPoint.metadata.node_data.title,
				question: dataPoint.metadata.node_data.description,
				value: dataPoint.value,
			}))

			if (interviewResponse) {
				const metadata: InterviewResponseMetadata = interviewResponse.metadata || {}
				metadata.data_points = simplifiedDataPoints
				interviewResponse.metadata = metadata
				await interviewResponse.save()
			}

			await getAndFireWebhooks(
				WebhookEventType.NEW_RESPONSE,
				interviewResponse.interview.id,
				interviewResponse.toPublic()
			).catch(captureError)
		}
	} catch (error) {
		captureError(error)
	}
}

/**
 * Handles the INTERVIEW_SCHEDULE_CALENDLY_EVENT event
 * - Analyzes the interview response and schedules a Calendly event if applicable
 * - Emits a NEW_RESPONSE webhook event
 *
 * @param interview_response_id the interview response id to analyze and schedule for
 */
const onInterviewScheduleCalendlyEvent = async ({ interview_response_id }: EventMap['INTERVIEW_SCHEDULE_CALENDLY_EVENT']) => {
	// Fetch interview response
	const interviewResponse = await InterviewResponseEntity.findOne({
		where: { id: interview_response_id },
		relations: ['interview', 'interview.flow', 'team', 'contact', 'contact.tags', 'job'],
	})

	if (!interviewResponse) {
		logger.error(`Response ${interview_response_id} not found.`)
		return
	}
	const calendlyFunction = interviewResponse.interview.flow.functions.find((fn) => fn.name === 'CALENDLY')

	if (!calendlyFunction) {
		logger.error(`No Calendly function found for interview ${interviewResponse.interview.id}`)
		return
	}

	if (!interviewResponse.contact) {
		throw new Error('No contact found for interview response')
	}

	// Get the date of the interview in the timezone of the Calendly function
	const dateInTimezone = new Date(interviewResponse.created).toLocaleString('en-US', { timeZone: calendlyFunction.metadata.timezone })

	// Define appointment scheduling tool
	const tools: ChatCompletionTool[] = [
		{
			type: 'function',
			function: {
				name: 'schedule_appointment',
				description: 'Schedule an appointment based on the conversation, if one is requested.',
				parameters: {
					type: 'object',
					properties: {
						event_was_scheduled: {
							type: 'boolean',
							description: 'Whether an event was scheduled.',
						},
						date: {
							type: 'string',
							description: 'The date and time of the appointment, in ISO 8601 format including timezone offset (e.g. 2024-03-04T19:00:00-05:00).',
						},
						schedulerEmail: {
							type: 'string',
							description: 'The caller-provided email address that should be used to schedule the appointment.',
						},
						schedulerName: {
							type: 'string',
							description: 'The caller-provided name that should be used to schedule the appointment.',
						},
					},
					required: ['date'],
				},
			},
		},
	]
	const tool_choice: ChatCompletionToolChoiceOption = {
		type: 'function',
		function: {
			name: 'schedule_appointment',
		},
	}

	// Define completion messages
	const messages: ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: `Given the provided call <transcript />, decide whether the user has selected a specific time for a meeting. If so, provide as many details as you can so the appointment can be scheduled.
			For reference, the time of this call was ${dateInTimezone.toLocaleString()}.
			The call took place in the following timezone: ${calendlyFunction.metadata.timezone}.
			
			If the caller provided an email address or name, include those in the scheduling details.
			If not, do not return an email address or name.
			If the caller spelled out an email address or name, include the correct spelling in the scheduling details.
			
			DO NOT make up any details. Only provide information that was explicitly stated in the call.`,
		},
		{
			role: 'system',
			content: `<transcript>\n${formatTranscript(interviewResponse)}</transcript>`,
		},
	]

	// Run OpenAI completion
	const { choices } = await azureAi({
		team_id: interviewResponse.team_id,
		'Helicone-Property-Feature': 'Calendly',
		'Helicone-Property-InterviewId': interviewResponse.interview.id,
		'Helicone-Property-InterviewResponseId': interview_response_id,
		model: AzureOpenAIModels.GPT_4,
	}).chat.completions.create({
		model: OpenAIModels.GPT_4,
		messages,
		tool_choice,
		tools,
	})

	// Parse completion results
	const args = JSON.parse(choices[0].message.tool_calls[0].function.arguments)
	logger.info(`Calendly event scheduling result: ${JSON.stringify(args)}`)

	// Pull provided scheduler details from completion, if applicable
	let { schedulerEmail, schedulerName } = args
	if (schedulerEmail?.includes('@example') || schedulerEmail?.includes('@acme')) {
		logger.warn('HALLUCINATION DETECTED')
		schedulerEmail = null
	}
	if (schedulerName === 'John Doe') {
		logger.warn('HALLUCINATION DETECTED')
		schedulerName = null
	}

	const dataPoints = await DataPointEntity.find({
		where: {
			response_id: interview_response_id,
			type: DataPointType.QUESTION_NODE,
		},
	})

	// Simplify data points for metadata
	const simplifiedDataPoints = dataPoints.map(dataPoint => ({
		title: dataPoint.metadata.node_data.title,
		question: dataPoint.metadata.node_data.description,
		value: dataPoint.value,
	}))
	if (!args.event_was_scheduled) {
		logger.info('No event was scheduled.')

		if (interviewResponse) {
			const metadata: InterviewResponseMetadata = interviewResponse.metadata || {}
			metadata.data_points = simplifiedDataPoints
			metadata.calendly_details = {
				scheduled_time: args.date,
				timezone: calendlyFunction.metadata.timezone,
				calendly_url: calendlyFunction.metadata.calendly_url,
				scheduled: false,
			}
			interviewResponse.metadata = metadata
			await interviewResponse.save()
		}

		await getAndFireWebhooks(
			WebhookEventType.NEW_RESPONSE,
			interviewResponse.interview.id,
			interviewResponse.toPublic()
		).catch(captureError)

		return
	}

	const time = moment(args.date).tz(calendlyFunction.metadata.timezone)
	logger.debug(`Trying to schedule Calendly event for ${time}`)

	const dateToSchedule = await getClosestAvailableTimeToDate({
		url: calendlyFunction.metadata.calendly_url,
		timezone: calendlyFunction.metadata.timezone,
		forwardDays: calendlyFunction.metadata.calendly_forward_days || 10,
	}, time)

	logger.debug(`Found date: ${dateToSchedule.format('MMMM Do, YYYY [at] h:mm a')}.Scheduling...`)

	// Prioritize scheduler details from completion, using contact as fallback
	const callerName = schedulerName || interviewResponse.contact.name || 'Unknown'
	const callerEmail = schedulerEmail || interviewResponse.contact.email || `${interviewResponse.contact.phone_number}@vztext.com`

	// Send emails to team members
	try {
		const teamMemberEmails = await getTeamUserEmails(interviewResponse.interview.team_id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email: email,
				type: TransactionalEmail.APPOINTMENT_SCHEDULED,
				data: {
					thoughtly_name: interviewResponse.interview.title,
					caller_name: callerName,
					caller_email: callerEmail,
					caller_phone: interviewResponse.contact.phone_number,
					appointment_date: time.format('MMMM Do, YYYY [at] h:mm a'),
				},
			})
		}
	} catch (error) {
		captureError(error)
	}

	// Update interview response metadata
	if (interviewResponse) {
		const metadata: InterviewResponseMetadata = interviewResponse.metadata || {}
		metadata.data_points = simplifiedDataPoints
		metadata.calendly_details = {
			scheduled_time: args.date,
			timezone: calendlyFunction.metadata.timezone,
			calendly_url: calendlyFunction.metadata.calendly_url,
			scheduled: true,
		}
		interviewResponse.metadata = metadata
		await interviewResponse.save()
	}

	// Send webhook events
	await getAndFireWebhooks(
		WebhookEventType.NEW_RESPONSE,
		interviewResponse.interview.id,
		interviewResponse.toPublic()
	).catch(captureError)

	// Schedule Calendly event with puppeteer helpers
	let browser
	try {
		browser = await launchCalendlyPage(calendlyFunction.metadata.calendly_url, calendlyFunction.metadata.timezone)
		await scheduleTime({
			browser,
			url: calendlyFunction.metadata.calendly_url,
			time: dateToSchedule,
			name: callerName,
			email: callerEmail,
			phone: interviewResponse.contact.phone_number,
		})
	} catch (error) {
		logger.error(`Error in scheduling Calendly event: ${error?.message ?? error}`)
		if (browser) {
			await browser.close()
		}
		return
	}

	logger.info(`Scheduled Calendly event for ${dateToSchedule}`)

	await DataPointEntity.create({
		response_id: interviewResponse.id,
		interview_id: interviewResponse.interview.id,
		team_id: interviewResponse.team.id,
		response_type: interviewResponse.type,
		type: DataPointType.ACTION_COMPLETED,
		value: 'CALENDLY',
	})
		.save()
		.catch(captureError)

	await browser.close()
}

/**
 * Handles the INTERVIEW_SCHEDULE_GHL_EVENT event
 * - Analyzes the interview response and schedules a HighLevel event if applicable
 * - Emits a NEW_RESPONSE webhook event
 *
 * @param interview_response_id the interview response id to analyze and schedule for
 */
const onInterviewScheduleGhlEvent = async ({ interview_response_id }: EventMap['INTERVIEW_SCHEDULE_GHL_EVENT']) => {
	// Fetch interview response
	const interviewResponse = await InterviewResponseEntity.findOne({
		where: { id: interview_response_id },
		relations: ['interview', 'interview.flow', 'team', 'contact', 'contact.tags', 'job'],
	})

	if (!interviewResponse) {
		logger.error(`Response ${interview_response_id} not found.`)
		return
	}
	const ghlFunction = interviewResponse.interview.flow.functions.find((fn) => fn.name === 'HIGHLEVEL')

	if (!ghlFunction) {
		logger.error(`No HighLevel function found for interview ${interviewResponse.interview.id}`)
		return
	}

	if (!interviewResponse.contact) {
		throw new Error('No contact found for interview response')
	}

	// Get the date of the interview in the timezone of the Calendly function
	const dateInTimezone = new Date(interviewResponse.created).toLocaleString('en-US', { timeZone: ghlFunction.metadata.timezone })

	// Define appointment scheduling tool
	const tools: ChatCompletionTool[] = [
		{
			type: 'function',
			function: {
				name: 'schedule_appointment',
				description: 'Schedule an appointment based on the conversation, if one is requested.',
				parameters: {
					type: 'object',
					properties: {
						event_was_scheduled: {
							type: 'boolean',
							description: 'Whether an event was scheduled.',
						},
						date: {
							type: 'string',
							description: 'The date and time of the appointment, in ISO 8601 format including timezone offset (e.g. 2024-03-04T19:00:00-05:00).',
						},
						schedulerEmail: {
							type: 'string',
							description: 'The caller-provided email address that should be used to schedule the appointment.',
						},
						schedulerName: {
							type: 'string',
							description: 'The caller-provided name that should be used to schedule the appointment.',
						},
					},
					required: ['date'],
				},
			},
		},
	]
	const tool_choice: ChatCompletionToolChoiceOption = {
		type: 'function',
		function: {
			name: 'schedule_appointment',
		},
	}

	// Define completion messages
	const messages: ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: `Given the provided call <transcript />, decide whether the user has selected a specific time for a meeting. If so, provide as many details as you can so the appointment can be scheduled.
			For reference, the time of this call was ${dateInTimezone.toLocaleString()}.
			The call took place in the following timezone: ${ghlFunction.metadata.timezone}.
			
			If the caller provided an email address or name, include those in the scheduling details.
			If not, do not return an email address or name.
			If the caller spelled out an email address or name, include the correct spelling in the scheduling details.
			
			DO NOT make up any details. Only provide information that was explicitly stated in the call.`,
		},
		{
			role: 'system',
			content: `<transcript>\n${formatTranscript(interviewResponse)}</transcript>`,
		},
	]

	// Run OpenAI completion
	const { choices } = await azureAi({
		team_id: interviewResponse.team_id,
		'Helicone-Property-Feature': 'Calendly',
		'Helicone-Property-InterviewId': interviewResponse.interview.id,
		'Helicone-Property-InterviewResponseId': interview_response_id,
		model: AzureOpenAIModels.GPT_4,
	}).chat.completions.create({
		model: OpenAIModels.GPT_4,
		messages,
		tool_choice,
		tools,
	})

	// Parse completion results
	const args = JSON.parse(choices[0].message.tool_calls[0].function.arguments)
	logger.info(`HighLevel event scheduling result: ${JSON.stringify(args)}`)

	// Pull provided scheduler details from completion, if applicable
	let { schedulerEmail, schedulerName } = args
	if (schedulerEmail?.includes('@example') || schedulerEmail?.includes('@acme')) {
		logger.warn('HALLUCINATION DETECTED')
		schedulerEmail = null
	}
	if (schedulerName === 'John Doe') {
		logger.warn('HALLUCINATION DETECTED')
		schedulerName = null
	}

	const dataPoints = await DataPointEntity.find({
		where: {
			response_id: interview_response_id,
			type: DataPointType.QUESTION_NODE,
		},
	})

	// Simplify data points for metadata
	const simplifiedDataPoints = dataPoints.map(dataPoint => ({
		title: dataPoint.metadata.node_data.title,
		question: dataPoint.metadata.node_data.description,
		value: dataPoint.value,
	}))
	if (!args.event_was_scheduled) {
		logger.info('No event was scheduled.')

		if (interviewResponse) {
			const metadata: InterviewResponseMetadata = interviewResponse.metadata || {}
			metadata.data_points = simplifiedDataPoints
			metadata.ghl_details = {
				scheduled_time: args.date,
				timezone: ghlFunction.metadata.timezone,
				calendar_id: ghlFunction.metadata.ghl_calendar_id,
				scheduled: false,
			}
			interviewResponse.metadata = metadata
			await interviewResponse.save()
		}

		await getAndFireWebhooks(
			WebhookEventType.NEW_RESPONSE,
			interviewResponse.interview.id,
			interviewResponse.toPublic()
		).catch(captureError)

		return
	}

	const time = moment(args.date).tz(ghlFunction.metadata.timezone)
	logger.debug(`Trying to schedule HighLevel event for ${time}`)

	const dateToSchedule = await ghl.getClosestAvailableTime({
		calendarId: ghlFunction.metadata.ghl_calendar_id,
		timezone: ghlFunction.metadata.timezone,
		integrationId: ghlFunction.metadata.integration_id,
		ghlLocationId: ghlFunction.metadata.location_id,
	}, time)

	logger.debug(`Found date: ${dateToSchedule.format('MMMM Do, YYYY [at] h:mm a')}. Scheduling...`)

	// Prioritize scheduler details from completion, using contact as fallback
	const callerName = schedulerName || interviewResponse.contact.name || 'Unknown'
	const callerEmail = schedulerEmail || interviewResponse.contact.email || `${interviewResponse.contact.phone_number}@vztext.com`

	// Send emails to team members
	try {
		const teamMemberEmails = await getTeamUserEmails(interviewResponse.interview.team_id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email: email,
				type: TransactionalEmail.APPOINTMENT_SCHEDULED,
				data: {
					thoughtly_name: interviewResponse.interview.title,
					caller_name: callerName,
					caller_email: callerEmail,
					caller_phone: interviewResponse.contact.phone_number,
					appointment_date: time.format('MMMM Do, YYYY [at] h:mm a'),
				},
			})
		}
	} catch (error) {
		captureError(error)
	}

	// Update interview response metadata
	if (interviewResponse) {
		const metadata: InterviewResponseMetadata = interviewResponse.metadata || {}
		metadata.data_points = simplifiedDataPoints
		metadata.ghl_details = {
			scheduled_time: args.date,
			timezone: ghlFunction.metadata.timezone,
			calendar_id: ghlFunction.metadata.ghl_calendar_id,
			scheduled: false,
		}
		interviewResponse.metadata = metadata
		await interviewResponse.save()
	}

	// Send webhook events
	await getAndFireWebhooks(
		WebhookEventType.NEW_RESPONSE,
		interviewResponse.interview.id,
		interviewResponse.toPublic()
	).catch(captureError)

	// Get integration and connection
	const integration = await IntegrationEntity.findOne({ where: { id: ghlFunction.metadata.integration_id } })

	// Fetch HighLevel contact
	let contact: GHLContact
	if (!interviewResponse.triggered_metadata.contact) {
		contact = await ghl.createContact({ integration, email: callerEmail, name: callerName, timezone: ghlFunction.metadata.timezone, ghlLocationId: ghlFunction.metadata.location_id })
	} else if (interviewResponse.triggered_metadata.contact) {
		contact = await ghl.getContact({ integration: integration, id: interviewResponse.triggered_metadata.contact.id }) as GHLContact
	}

	const scheduled = await ghl.createAppointment({ integration, contact, calendarId: ghlFunction.metadata.ghl_calendar_id, date: dateToSchedule, ghlLocationId: ghlFunction.metadata.location_id })

	if (scheduled) {
		logger.info(`Scheduled HighLevel event for ${dateToSchedule}`)
	} else {
		logger.error(`Failed to schedule HighLevel event for ${dateToSchedule}`)
	}

	await DataPointEntity.create({
		response_id: interviewResponse.id,
		interview_id: interviewResponse.interview.id,
		team_id: interviewResponse.team.id,
		response_type: interviewResponse.type,
		type: DataPointType.ACTION_COMPLETED,
		value: 'HIGHLEVEL',
	})
		.save()
		.catch(captureError)
}

export {
	onInterviewEnd,
	onInterviewScheduleCalendlyEvent,
	onInterviewScheduleGhlEvent,
}
