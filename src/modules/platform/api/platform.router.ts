import { Router } from 'express'
import { getPlatformStatus } from './platform.handlers'

export const platformRouter = Router()

platformRouter.get(
	'/status',
	getPlatformStatus
)
