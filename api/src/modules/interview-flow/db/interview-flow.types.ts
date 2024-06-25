export type SegmentType = 'question' | 'information' | 'action' | 'genius' | 'a/b';

export interface KeyValue {
	key: string;
	value: {id: string; value: string};
	type: 'string' | 'number' | 'boolean' | 'object';
}

export type InterviewGeniusData = {
	id: string
	question: string
	answer: string
}

export type ApiRequest = {
	url?: string
	method?: string
	query?: KeyValue[]
	body?: KeyValue[]
	headers?: KeyValue[]
	name?: string
}

export type InterviewNodeData = {
	type: 'start' | 'end' | 'segment'
	segment_type?: SegmentType
	title?: string
	description?: string
	outcomes?: string[]
	function?: InterviewFunction
	phone_number?: string
	phone_number_name?: string
	api_request?: ApiRequest
	perform_secondary_action?: boolean
	agent_transfer?: {interview_id: string, interview_title: string, agent_name: string}
	additional_prompting?: string[]
	times_visited?: number
}

export type XYPosition = {
	x: number
	y: number
}

export type InterviewNode = {
	id: string
	position: XYPosition
	data: InterviewNodeData
	type?: 'start' | 'end' | 'segment'
	width?: number
	height?: number
	dragging?: boolean
	selected?: boolean
	positionAbsolute?: XYPosition
}

export type InterviewEdge = {
	id: string
	source: string
	sourceHandle: string
	target: string
	targetHandle: string
}

export enum InterviewFunctionName {
	PHONE_ROUTER = 'PHONE_ROUTER',
	CALENDLY = 'CALENDLY',
	HIGHLEVEL = 'HIGHLEVEL',
	API_CALL = 'API_CALL',
	AGENT_TRANSFER = 'AGENT_TRANSFER',
}

export type InterviewFunctionParameters = {
	type: string
	description: string
	enum?: string[]
	properties?: Record<string, InterviewFunctionParameters>
}

export type InterviewFunction = {
	name: string
	parameters: InterviewFunctionParameters
	description: string
	response: string
	metadata?: Partial<InterviewFunctionMetadata>
}

export type InterviewFunctionMetadata = {
	phone_number_directory?: { name: string; phone_number: string }[]
	calendly_url?: string
	timezone?: string
	calendly_forward_days?: number
	ghl_calendar_id?: string
	integration_id?: string
	location_id?: string
}
