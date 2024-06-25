export type InterviewOutlineItem = {
    text: string
    duration_ms: number
}

export enum InterviewStatus {
    ACTIVE = 'ACTIVE',
    ARCHIVED = 'ARCHIVED',
}

export enum InterviewType {
    GENERAL = 'GENERAL',
    POLITICAL_POLLING = 'POLITICAL_POLLING',
    SALES = 'SALES',
    CANDIDATE_SCREENING = 'CANDIDATE_SCREENING',
    MARKET_RESEARCH = 'MARKET_RESEARCH',
    PRODUCT_REVIEW = 'PRODUCT_REVIEW',
    VIRTUAL_RECEPTIONIST = 'VIRTUAL_RECEPTIONIST',
}

export enum InterviewLanguage {
    'en' = 'en',
    'es' = 'es',
    'it' = 'it',
    'de' = 'de',
    'fr' = 'fr',
    'pt' = 'pt',
    'nl' = 'nl',
    'hi' = 'hi',
    'da' = 'da',
    'pl' = 'pl',
    'uk' = 'uk',
    'ru' = 'ru',
    'tr' = 'tr'
}

export enum PresenceInterimAudio {
    KEYBOARD_TYPING = 'KEYBOARD_TYPING',
}

export enum PresenceBackgroundAudio {
    CALL_CENTER = 'call_center',
    CITY_STREET = 'city_street',
    COFFEE_SHOP = 'coffee_shop',
    CAR_INTERIOR = 'car_interior',
    SUBWAY = 'subway'
}

export type PersonalityCustomization = {
    assertiveness_level: number;
    humor_level: number;
};

export enum PersonalityType {
    ASSERTIVENESS = 'ASSERTIVENESS',
    HUMOR = 'HUMOR',
}

export type MetricDetails = {
    icon: string;
    color: string;
    description: string;
    value: string;
    method: MetricMethod;
    type: MetricType;
    base?: PercentageBase;
};

export enum MetricMethod {
    SUM = 'sum',
    PERCENTAGE = 'percentage',
    AVERAGE = 'average',
}

export enum MetricType {
    STATUS = 'status',
    TAG = 'tag',
}

export enum PercentageBase {
    TOTAL_RESPONSES = 'TOTAL_RESPONSES',
    ENDED = 'ENDED',
    NO_ANSWER = 'NO_ANSWER',
}

export enum StatusMetric {
    NOT_STARTED = 'NOT_STARTED',
    IN_PROGRESS = 'IN_PROGRESS',
    ENDED = 'ENDED',
    NO_ANSWER = 'NO_ANSWER',
    VOICEMAIL = 'VOICEMAIL',
    TRANSFERRED = 'TRANSFERRED',
    FAILED = 'FAILED',
    TOTAL_RESPONSES = 'TOTAL_RESPONSES',
    DURATION = 'DURATION',
    PICKUP_RATE = 'PICKUP_RATE',
}
