import { Router } from 'express'
import {
	getUser, sendPhoneNumberVerificationCode, updateUserDetails, verifyAndSetPhoneNumber,
} from './user.handlers'
import userSchema from './user.schema'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import { registerOpenApiSchema } from '../../../services/server/openapi'
import { UserEntity } from '../db/user.entity'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const userRouter = Router()
const logDetails = {
	getUser: {
		method: 'GET',
		reason: 'Request to get all user',
		resource: 'user',
	},
	updateUserDetails: {
		method: 'POST',
		reason: 'Request to update user details',
		resource: 'user',
	},
	sendPhoneNumberVerificationCode: {
		method: 'POST',
		reason: 'Request to send phone number verification code',
		resource: 'user',
	},
	verifyAndSetPhoneNumber: {
		method: 'POST',
		reason: 'Reques to verify and set phone number',
		resource: 'user',
	},
}
userRouter.get(
	'/',
	auditMiddleware(logDetails.getUser),
	getUser
)

registerOpenApiSchema({
	method: 'get',
	path: '/user',
	responseBody: UserEntity,
	description: 'Get user details',
})

userRouter.post(
	'/update_profile',
	validator(userSchema.updateUserDetails, RequestPart.BODY),
	auditMiddleware(logDetails.updateUserDetails),
	updateUserDetails
)

userRouter.post(
	'/send_phone_number_verification_code',
	validator(userSchema.sendPhoneNumberVerificationCode, RequestPart.BODY),
	auditMiddleware(logDetails.sendPhoneNumberVerificationCode),
	sendPhoneNumberVerificationCode
)

userRouter.post(
	'/verify_and_set_phone_number',
	validator(userSchema.verifyAndSetPhoneNumber, RequestPart.BODY),
	auditMiddleware(logDetails.verifyAndSetPhoneNumber),
	verifyAndSetPhoneNumber
)
