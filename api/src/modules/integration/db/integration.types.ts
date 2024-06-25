export enum IntegrationApiType {
	NANGO = 'nango',
}

export type IntegrationAuthMetadata = {
	nango_connection_id: string
	nango_connection_config: Record<string, any>
}

export interface AvailableTrigger {
	name: string
	description: string
	subscription_type: string
}

export interface GHLCalendar {
	id: string
	name: string
	calendarType: string
}
