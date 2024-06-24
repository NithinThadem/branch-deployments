import { AuthenticatedRequest } from '../../../types'
import analytics from '../../../services/segment'
import { TriggerEntity } from '../db/trigger.entity'
import response from '../../../services/server/response'
import { captureError } from '../../../util/error.util'

/**
 * Handles the creation of a new trigger
 */
const triggerCreateHandler = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const { name, type, subscription_type, interview_id, integration_id, location_id } = req.body

	if (type && !['start', 'end'].includes(type)) {
		return response({ res, status: 400, data: { message: `Invalid type provided - ${type}` } })
	}

	// Create trigger
	const trigger = await TriggerEntity.create({
		type,
		subscription_type,
		name,
		interview: {
			id: interview_id,
		},
		integration: {
			id: integration_id,
		},
		metadata: {
			location_id,
		},
	}).save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Trigger Created',
			properties: {
				team_id: req.headers.team_id,
				trigger_id: trigger.id,
				integration_id,
				interview_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: trigger.toPublic() })
}

/**
 * Handles the retrieval of all triggers for the requested interview
 */
const getTriggersHandler = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const interview_id = req.query.interview_id
		const triggers = await TriggerEntity.find({
			where: {
				interview: {
					id: interview_id,
				},
			},
		})

		return response({ res, data: triggers.map((trigger) => trigger.toPublic()) })
	} catch (error) {
		captureError(error)
		return response({ res, status: 500, data: { message: 'Failed to get triggers' } })
	}
}

const deleteTriggerHandler = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const { trigger_id } = req.params

	const trigger = await TriggerEntity.findOneOrFail({
		where: { id: trigger_id },
	})

	await trigger.remove()

	try {
		analytics.track({
			userId: user.id,
			event: 'Trigger Deleted',
			properties: {
				team_id: req.headers.team_id,
				trigger_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: { message: 'Trigger deleted successfully' } })
}

export { triggerCreateHandler, getTriggersHandler, deleteTriggerHandler }
