import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import triggerSchema from './trigger.schema'
import { triggerCreateHandler, getTriggersHandler, deleteTriggerHandler } from './trigger.handlers'

export const triggerRouter = Router()

triggerRouter.post(
	'/create',
	validator(triggerSchema.create_trigger, RequestPart.BODY),
	triggerCreateHandler,
)

triggerRouter.get(
	'/',
	validator(triggerSchema.get_trigger_query, RequestPart.QUERY),
	getTriggersHandler,
)

triggerRouter.delete(
	'/:trigger_id',
	validator(triggerSchema.delete_trigger, RequestPart.PARAMS),
	deleteTriggerHandler,
)
