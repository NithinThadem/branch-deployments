type DateRange = {
    start_date: string;
    end_date: string;
};

type InterviewData = {
    actions_completed: Record<string, number>;
    node_completed_counts: Record<string, number>;
    node_analysis: Record<string, QuestionAnswer>;
};

type DeploymentData = {
    total_duration: number;
    total_deployments: number;
    total_drop_offs?: number;
    total_pickups?: number;
    total_voicemails?: number;
    total_no_answers?: 0
};

type ThoughtlyResponse = {
    interview_id: string
    duration_ms: number
}

type QuestionAnswer = {
    title: string;
    description: string;
    strict_answers: Record<string, number>;
};

export interface GlobalAction {
    action: string;
    count: number;
    interview_id: string;
}

export type ActionDataDetail = {
    count: number;
    interview_id: string;
}

export interface NodeAnswerDetail {
    answer: string;
    count: number;
}

export interface GlobalNodeAnalysis {
    node_id: string;
    interview_id: string
    title: string;
    description: string;
    answers: NodeAnswerDetail[];
}

export type TotalData = {
    date_range: DateRange;
    interview: InterviewData;
    total_time_used?: number;
    total_deployments: number;
    total_responses: number;
    top_thoughtlys: ThoughtlyResponse[];
    call_summary?: {
        regionCode: string
        areaCodes?: Record<string, number>
        count: number
    }[]
    BROWSER_TEXT: DeploymentData;
    BROWSER_CALL: DeploymentData;
    global_top_actions: GlobalAction[];
    global_top_node_analysis: GlobalNodeAnalysis[];
};
export type TeamBusinessMetadata = {
    name: string
    type: string
    industry: string
    registration_id_type: string
    registration_number: string
    regions_of_operation: string
    website_url: string
    address: {
        line_1: string
        line_2: string
        city: string
        state: string
        postal_code: string
        country: string
    }
    authorized_signatory: {
        title: string
        first_name: string
        last_name: string
    }
    business_information_sid?: string
    authorized_rep_sid?: string
    address_sid?: string
    company_type: string
    stock_exchange?: string
    stock_ticker?: string
    campaign_data: {
        description: string
        message_flow: string,
        usecase: string,
        message_samples: string[],
        has_embedded_links: boolean,
        has_embedded_phone: boolean,
        opt_in_message?: string,
        opt_out_message?: string,
        help_message?: string,
        opt_in_keywords?: string[],
        opt_out_keywords?: string[],
        help_keywords?: string[],
    }
    email?: string
}

export enum A2P_BRAND_STATUS {
    DRAFT = 'draft',
    PENDING = 'pending',
    REGISTERED = 'registered',
    FAILED = 'registration_failed',
    APPROVED = 'approved'
}

export enum A2P_TRUST_BUNDLE_STATUS {
    DRAFT = 'draft',
    PENDING_REVIEW = 'pending-review',
    IN_REVIEW = 'in-review',
    TWILIO_REJECTED = 'twilio-rejected',
    TWILIO_APPROVED = 'twilio-approved'
}

export enum A2P_CAMPAIGN_STATUS {
    DRAFT = 'draft',
    PENDING = 'pending',
    SUCCESS = 'success',
    FAILURE = 'failure'
}

export type TeamTwilioMetadata = {
    twilio_customer_a2p_bundle_status: string
    twilio_customer_a2p_brand_status: string
    twilio_customer_a2p_campaign_status: string
    twilio_shaken_stir_status: string
    twilio_customer_bundle_sid?: string
    twilio_customer_brand_registration_sid?: string
    twilio_customer_messaging_service_sid?: string
    twilio_customer_shaken_stir_sid?: string
    twilio_customer_a2p_bundle_failure_reason?: string
    twilio_customer_shaken_stir_failure_reason?: string
    twilio_customer_a2p_brand_failure_reason?: string
    twilio_customer_a2p_campaign_failure_reason?: string[]
    twilio_customer_profile_failure_reason?: string
    twilio_customer_profile_sid?: string
    twilio_customer_profile_status: string
    twilio_customer_cnam_trust_product_sid?: string
    twilio_cnam_trust_product_status?: string
    legacy_metadata?: {
        twilio_customer_profile_sid?: string
        twilio_customer_profile_status?: string
        twilio_customer_profile_failure_reason?: string
    }
}
