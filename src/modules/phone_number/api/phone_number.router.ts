import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import phoneNumberSchema from './phone_number.schema'
import { RequestPart } from '../../../types'
import { teamOnlyMiddleware } from '../../../services/server/middleware/auth.middleware'
import {
	assignPhoneNumber,
	cancelPhoneNumber,
	fetchAvailableNumbers, getPhoneNumbers, purchaseNumber, releasePhoneNumber,
} from './phone_number.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const phoneNumberRouter = Router()
const logDetails = {
	getPhoneNumbers: {
		method: 'GET',
		reason: 'Request to get all phone numbers',
		resource: 'phone_number',
	},
	fetchAvailableNumbers: {
		method: 'GET',
		reason: 'Requst fetch all available numbers',
		resource: 'phone_number',
	},
	purchaseNumber: {
		method: 'POST',
		reason: 'Requst to purchase phone number',
		resource: 'phone_number',
	},
	releasePhoneNumber: {
		method: 'POST',
		reason: 'Request to release phone number',
		resource: 'phone_number',
	},
	cancelPhoneNumber: {
		method: 'POST',
		reason: 'Request to cancel phone number',
		resource: 'pnone_number',
	},
	assignPhoneNumber: {
		method: 'POST',
		reason: 'Request to assign phone number',
		resource: 'pnone_number',
	},
}

phoneNumberRouter.get(
	'/',
	validator(phoneNumberSchema.getPhoneNumbers, RequestPart.QUERY),
	auditMiddleware(logDetails.getPhoneNumbers),
	getPhoneNumbers
)

phoneNumberRouter.get(
	'/available',
	validator(phoneNumberSchema.getAvailableNumbers, RequestPart.QUERY),
	auditMiddleware(logDetails.fetchAvailableNumbers),
	fetchAvailableNumbers
)

phoneNumberRouter.post(
	'/buy',
	teamOnlyMiddleware,
	validator(phoneNumberSchema.buyPhoneNumber, RequestPart.BODY),
	auditMiddleware(logDetails.purchaseNumber),
	purchaseNumber
)

phoneNumberRouter.post(
	'/release',
	teamOnlyMiddleware,
	validator(phoneNumberSchema.releasePhoneNumber, RequestPart.BODY),
	auditMiddleware(logDetails.releasePhoneNumber),
	releasePhoneNumber
)

phoneNumberRouter.post(
	'/cancel',
	teamOnlyMiddleware,
	validator(phoneNumberSchema.phoneNumber, RequestPart.BODY),
	auditMiddleware(logDetails.cancelPhoneNumber),
	cancelPhoneNumber
)

phoneNumberRouter.post(
	'/assign',
	validator(phoneNumberSchema.assignPhoneNumber, RequestPart.BODY),
	auditMiddleware(logDetails.assignPhoneNumber),
	assignPhoneNumber
)
