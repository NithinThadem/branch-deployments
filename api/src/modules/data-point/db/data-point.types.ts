import { InterviewNodeData } from '../../interview-flow/db/interview-flow.types'
import { ActionData, InterviewResponseType } from '../../interview-response/db/interview-response.types'

export enum DataPointType {
    QUESTION_NODE = 'QUESTION_NODE',
    CALL_DATA = 'CALL_DATA',
    ACTION_COMPLETED = 'ACTION_COMPLETED',
    THOUGHTLY_END_DATA = 'THOUGHTLY_END_DATA',
    NODE_COMPLETED = 'NODE_COMPLETED',
    VOICEMAIL = 'VOICEMAIL',
    NO_ANSWER = 'NO_ANSWER',
    VIOLATION = 'VIOLATION'
}

export enum DataPointValueType {
    STRICT = 'STRICT',
    OTHER = 'OTHER',
}

export type ActionsCompletedType = {
    [key: string]: number;
};

export type NodeAnalysisType = {
    [key: string]: {
        title: string;
        description: string;
        strict_answers: {
            [key: string]: number;
        };
        other_answers: string[];
    };
};

export type ThoughtlyEndType = {
    reason?: string
    phone_number: string
    response_type?: InterviewResponseType
    start_time?: Date
    duration?: number
}

export interface DataPointMetadata {
    actions_completed?: ActionData[]
    thoughtly_end?: ThoughtlyEndType
    node_data?: InterviewNodeData
}

export interface DataPoint {
    type: DataPointType
    interview?: {
        id: string
    };
    response?: {
        type: string
        duration_ms: string
        start_time: string
    };
    metadata?: DataPointMetadata
}
