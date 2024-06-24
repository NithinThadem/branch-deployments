import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import smsMessageSchema from './sms-message.schema'
import apiSchema from '../../../services/server/api.schema'
import { getSmsMessages, getSmsMessagesForPhoneNumber } from './sms-message.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const smsMessageRouter = Router()
const logDetails = {
	getSmsMessage: {
		method: 'GET',
		reason: 'Request to get sms messages',
		resource: 'message',
	},
	getSmsMessagesForPhoneNumber: {
		method: 'GET',
		reason: 'Request to get sms messages for phone number',
		resource: 'message',
	},
}

smsMessageRouter.get(
	'/',
	validator(apiSchema.paginated, RequestPart.QUERY),
	auditMiddleware(logDetails.getSmsMessage),
	getSmsMessages
)

smsMessageRouter.get(
	'/:phone_number_id',
	validator(smsMessageSchema.phoneNumberId, RequestPart.PARAMS),
	validator(apiSchema.paginated, RequestPart.QUERY),
	auditMiddleware(logDetails.getSmsMessagesForPhoneNumber),
	getSmsMessagesForPhoneNumber
)
