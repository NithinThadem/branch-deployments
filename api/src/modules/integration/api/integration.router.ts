import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import integrationSchema from './integration.schema'
import {
	deleteNangoIntegration,
	exchangeNangoHmac,
	getConnectedIntegrations,
	getZapierApps,
	getAvailableGHLCalendars,
	getAvailableGHLAccounts,
} from './integration.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const integrationRouter = Router()
const logDetails = {
	getConnectedIntegrations: {
		method: 'GET',
		reason: 'Request to get connected integrations',
		resource: 'integration',
	},
	getZapierApps: {
		method: 'GET',
		reason: 'Request to get zapier apps',
		resource: 'integration',
	},
	exchangeNangoHmac: {
		method: 'POST',
		reason: 'Request to exchange NangoHmac',
		resource: 'integration',
	},
	deleteNangoIntegration: {
		method: 'DELETE',
		reason: 'Request to delete Nango integration',
		resource: 'integration',
	},
}

integrationRouter.get(
	'/',
	auditMiddleware(logDetails.getConnectedIntegrations),
	getConnectedIntegrations
)

integrationRouter.get(
	'/zapier/apps',
	validator(integrationSchema.getZapierApps, RequestPart.QUERY),
	auditMiddleware(logDetails.getZapierApps),
	getZapierApps
)

integrationRouter.get(
	'/ghl/calendars',
	getAvailableGHLCalendars,
)

integrationRouter.get(
	'/ghl/accounts',
	getAvailableGHLAccounts,
)

integrationRouter.post(
	'/nango/hmac',
	validator(integrationSchema.exchangeNangoHmac, RequestPart.BODY),
	auditMiddleware(logDetails.exchangeNangoHmac),
	exchangeNangoHmac
)

integrationRouter.delete(
	'/:integration_id',
	validator(integrationSchema.integrationId, RequestPart.PARAMS),
	auditMiddleware(logDetails.deleteNangoIntegration),
	deleteNangoIntegration
)
