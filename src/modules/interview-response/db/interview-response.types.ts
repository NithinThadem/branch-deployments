import { GHLContact } from '../../../services/ghl'

/* eslint-disable max-len */
export type PhoneRouterActionDetail = {
    action_type: 'PHONE_ROUTER'
    phone_number: string
};

export type ActionDetail = PhoneRouterActionDetail

export type CompletionDataResponse = {
    data?: Record<string, unknown>
    action_detail?: ActionDetail
    node_id?: string
    secondary_action?: string
};

export type ConversationHistory = {
    date: Date
    author: 'system' | 'ai' | 'user'
    text: string
    audio_url?: string
    video_url?: string
    transcript?: string
    cumulative_duration_ms?: number
    completion_data?: CompletionDataResponse
    voicemail_audio_url?: string
    voicemail_content?: string
}

export enum InterviewResponseStatus {
    NOT_STARTED = 'NOT_STARTED',
    IN_PROGRESS = 'IN_PROGRESS',
    ENDED = 'ENDED',
    NO_ANSWER = 'NO_ANSWER',
    VOICEMAIL = 'VOICEMAIL',
    TRANSFERRED = 'TRANSFERRED',
    FAILED = 'FAILED',
    VIOLATION = 'VIOLATION',
}

export enum InterviewResponseType {
    PHONE_CALL = 'PHONE_CALL',
    BROWSER_CALL = 'BROWSER_CALL',
    BROWSER_TEXT = 'BROWSER_TEXT',
    AGENT_TRANSFER = 'AGENT_TRANSFER',
    SMS = 'SMS',
    INBOUND_CALL = 'INBOUND_CALL',
    WIDGET = 'WIDGET',
}
export type CallData = {
    to: string,
    toFormatted: string,
    from: string,
    fromFormatted: string,
    phoneNumberSid: string,
    status: string,
    startTime: Date,
    endTime: Date,
    duration: string,
    price: string,
    priceUnit: string,
    direction: string,
    answeredBy: string,
    forwardedFrom: string,
    callerName: string,
    queueTime: string,
};

export type ActionData = {
    action_type: string;
    action_details: any;
};

export type SummaryData = {
    summary: string;
    response_tags: string[];
};

export type TriggeredMetadata = {
    triggered_by?: string,
    request_ip?: string,
    api_token?: string
    contact?: GHLContact | Record<string, any>
}

type DataPoint = {
    title: string;
    question: string;
    value: string;
};

type CalendlyDetails = {
    scheduled_time: string | null;
    timezone: string;
    calendly_url: string;
    scheduled?: boolean;
};

export type HighLevelDetails = {
    scheduled_time: string | null;
    timezone: string;
    calendar_id: string;
    scheduled?: boolean;
};

type AdditionalMetadata = Record<string, any>

export type InterviewResponseMetadata = AdditionalMetadata & {
    data_points?: DataPoint[];
    calendly_details?: CalendlyDetails;
    ghl_details?: HighLevelDetails;
    twilio_call_time_ms?: number;
}
