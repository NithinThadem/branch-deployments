import { isTesting } from '../../util/env.util'
import logger from '../../util/logger.util'
import { EventMap } from './event.map'
import { EventUtil as EventUtilBase } from './event.util'
import * as interviewEvent from './handlers/interview.event'
import jobEvent from './handlers/job.event'
import * as userEvent from './handlers/user.event'
import * as contactEvent from './handlers/contact.event'
import * as phoneNumberEvent from './handlers/phone_number.event'
import teamEvent from './handlers/team.event'
import geniusEvent from './handlers/genius.event'
import integrationsEvent from './handlers/integrations.event'

const EventUtil = new EventUtilBase()

// Called in local dev environment

if (process.env.NODE_ENV === 'development' || isTesting()) {
	EventUtil.on('USER_UPDATED', userEvent.onUserUpdated)
	EventUtil.on('USER_INVITED', userEvent.onUserInvited)

	EventUtil.on('JOB_START', jobEvent.onJobStart)
	EventUtil.on('BULK_CONTACTS_CREATED', contactEvent.onBulkContactsCreated)

	EventUtil.on('PHONE_NUMBER_PURCHASED', phoneNumberEvent.onPhoneNumberPurchased)
	EventUtil.on('PHONE_NUMBER_CANCELLED', phoneNumberEvent.onPhoneNumberCancelled)

	EventUtil.on('INTERVIEW_END', interviewEvent.onInterviewEnd)
	EventUtil.on('INTERVIEW_SCHEDULE_CALENDLY_EVENT', interviewEvent.onInterviewScheduleCalendlyEvent)
	EventUtil.on('INTERVIEW_SCHEDULE_GHL_EVENT', interviewEvent.onInterviewScheduleGhlEvent)

	EventUtil.on('TEAM_OVER_ALLOWED_MINUTES', teamEvent.onTeamOverAllowedMinutes)

	EventUtil.on('GENIUS_UPLOAD_AUDIO', geniusEvent.onGeniusUploadAudio)
	EventUtil.on('GENIUS_UPLOAD_TEXT', geniusEvent.onGeniusUploadText)
	EventUtil.on('GENIUS_UPLOAD_URL', geniusEvent.onGeniusUploadUrl)
	EventUtil.on('GENIUS_UPLOAD_FILE', geniusEvent.onGeniusUploadFile)
	EventUtil.on('GENIUS_DELETE_DATABASE', geniusEvent.onGeniusDeleteDatabase)

	EventUtil.on('INTEGRATION_TRIGGER', integrationsEvent.onIntegrationTrigger)

	EventUtil.on('CHECK_FOR_TWILIO_MIGRATIONS', teamEvent.onCheckForTwilioMigrations)
}

// Called by Pub/Sub handler (returns promise)

export const handleEvent = async (event: keyof EventMap, args: any): Promise<any> => {
	logger.debug(`[Event] Called handleEvent: ${event}`)
	switch (event) {
		case 'USER_UPDATED': return userEvent.onUserUpdated(args)
		case 'USER_INVITED': return userEvent.onUserInvited(args)
		case 'JOB_START': return jobEvent.onJobStart(args)
		case 'BULK_CONTACTS_CREATED': return contactEvent.onBulkContactsCreated(args)

		case 'PHONE_NUMBER_PURCHASED': return phoneNumberEvent.onPhoneNumberPurchased(args)
		case 'PHONE_NUMBER_CANCELLED': return phoneNumberEvent.onPhoneNumberCancelled(args)

		case 'INTERVIEW_END': return interviewEvent.onInterviewEnd(args)
		case 'INTERVIEW_SCHEDULE_CALENDLY_EVENT': return interviewEvent.onInterviewScheduleCalendlyEvent(args)
		case 'INTERVIEW_SCHEDULE_GHL_EVENT': return interviewEvent.onInterviewScheduleGhlEvent(args)

		case 'TEAM_OVER_ALLOWED_MINUTES': return teamEvent.onTeamOverAllowedMinutes(args)

		case 'GENIUS_UPLOAD_AUDIO': return geniusEvent.onGeniusUploadAudio(args)
		case 'GENIUS_UPLOAD_TEXT': return geniusEvent.onGeniusUploadText(args)
		case 'GENIUS_UPLOAD_URL': return geniusEvent.onGeniusUploadUrl(args)
		case 'GENIUS_UPLOAD_FILE': return geniusEvent.onGeniusUploadFile(args)
		case 'GENIUS_DELETE_DATABASE': return geniusEvent.onGeniusDeleteDatabase(args)

		case 'INTEGRATION_TRIGGER': return integrationsEvent.onIntegrationTrigger(args)

		case 'CHECK_FOR_TWILIO_MIGRATIONS': return teamEvent.onCheckForTwilioMigrations(args)

		default: throw new Error(`[Event] Unknown event: ${event}`)
	}
}

export { EventMap }
export default EventUtil
