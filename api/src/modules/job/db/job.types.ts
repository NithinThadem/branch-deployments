export enum JobStatus {
	NOT_STARTED = 'NOT_STARTED',
	IN_PROGRESS = 'IN_PROGRESS',
	CANCELED = 'CANCELED',
	COMPLETE = 'COMPLETE',
}

export type JobLog = {
	created: Date
	text: string
}

export enum JobType {
	CONTACTS = 'CONTACTS',
	SMS = 'SMS',
	RESPONSES = 'RESPONSES',
	GENERAL = 'GENERAL',
}

export type PhoneBlock = {
	npa: string
	nxx?: string
}

export type RddConfig = {
	phone_blocks: PhoneBlock[]
	sample_interval: number
}
