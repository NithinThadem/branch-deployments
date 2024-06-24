import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import { createToken, getTokens, revokeToken } from './api-token.handlers'
import apiTokenSchema from './api-token.schema'

export const apiTokenRouter = Router()

apiTokenRouter.get(
	'/',
	getTokens
)

apiTokenRouter.post(
	'/create',
	createToken
)

apiTokenRouter.post(
	'/:token_id/revoke',
	validator(apiTokenSchema.revoke, RequestPart.PARAMS),
	revokeToken
)
