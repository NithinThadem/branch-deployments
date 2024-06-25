export enum ContactStatus {
	ACTIVE = 'ACTIVE',
	INACTIVE = 'INACTIVE',
	DNC = 'DNC',
}

export enum LeadSourceTypes {
	DASHBOARD_BULK_UPLOAD = 'DASHBOARD_BULK_UPLOAD',
	DASHBOARD_UPLOAD = 'DASHBOARD_UPLOAD',
	API_UPLOAD = 'API_UPLOAD',
	API_BULK_UPLOAD = 'API_BULK_UPLOAD',
	HIGH_LEVEL = 'HIGH_LEVEL',
	HUBSPOT = 'HUBSPOT',
	SALESFORCE = 'SALESFORCE',
}

export interface HubspotContact {
	id: string
	properties: {
		createdate: string
		email?: string
		firstname?: string
		lastname?: string
		phone?: string
		hs_object_id: string
		lastmodifieddate: string
	}
	createdAt: string
	updatedAt: string
	archived: boolean
}

export interface GoHighLevelContact {
id: string
// todo
}

export type SystemType = {
	type: 'hubspot';
	contact: HubspotContact;
} | {
	type: 'go_high_level';
	contact: GoHighLevelContact;
};
