import { LeadSourceTypes } from '../../modules/contact/db/contact.types'
import { TriggeredMetadata } from '../../modules/interview-response/db/interview-response.types'
import { UserEntity } from '../../modules/user/db/user.entity'

export type EventMap = {
    'INTERVIEW_END': { interview_response_id: string }

    'INTERVIEW_SCHEDULE_CALENDLY_EVENT': { interview_response_id: string }
    'INTERVIEW_SCHEDULE_GHL_EVENT': { interview_response_id: string }

    'TEAM_OVER_ALLOWED_MINUTES': { team_id: string }

    'USER_UPDATED': { user_id: string }
    'USER_INVITED': { team_id: string; invited_user_id: string; from_user_id: string }
    'JOB_START': { job_id: string, user: UserEntity, triggered_metadata?: TriggeredMetadata }
    'BULK_CONTACTS_CREATED': {
        team_id: string;
        user_email: string;
        file_url: string;
        active_headers: string[];
        country_code: string
        addedTags: string[]
        leadSource: LeadSourceTypes
    }

    'PHONE_NUMBER_PURCHASED': { phone_number: string, subscription_id: string }
    'PHONE_NUMBER_CANCELLED': { phone_number: string, subscription_id: string }

    'GENIUS_UPLOAD_AUDIO': { genius_source_id: string }
    'GENIUS_UPLOAD_TEXT': { genius_source_id: string }
    'GENIUS_UPLOAD_URL': { genius_source_id: string }
    'GENIUS_UPLOAD_FILE': { genius_source_id: string }
    'GENIUS_DELETE_DATABASE': { genius_id: string };

    'INTEGRATION_TRIGGER': {
        trigger_id: string
        payload: any
    }

    'CHECK_FOR_TWILIO_MIGRATIONS': { team_id: string }
}
