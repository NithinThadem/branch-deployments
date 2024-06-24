export enum SubscriptionStatus {
	ACTIVE = 'active',
	CANCELED = 'canceled',
	INCOMPLETE = 'incomplete',
	INCOMPLETE_EXPIRED = 'incomplete_expired',
	PAST_DUE = 'past_due',
	PAUSED = 'paused',
	TRIALING = 'trialing',
	UNPAID = 'unpaid',
}

export enum SubscriptionPlans {
	BASIC = 'BASIC',
	PRO = 'PRO',
	BUSINESS = 'BUSINESS',
	PHONE_NUMBER = 'PHONE_NUMBER',
	AGENCY = 'AGENCY',
	ENTERPRISE_MINUTES = 'ENTERPRISE_MINUTES',
}
