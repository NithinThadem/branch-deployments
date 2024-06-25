import { Request, Response, NextFunction } from 'express'
import { logAction } from '../../../modules/audit-log/db/audit-log.helpers'
import logger from '../../../util/logger.util'
import { v4 } from 'uuid'

export const auditMiddleware = (logDetails: any) => async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { method, reason, resource } = logDetails
		const teamId = req.headers.team_id
		const sessionId = v4()
		const { id, email, first_name, last_name } = await req.auth.getUser()
		const details = {
			before: {
				name: first_name + ' ' + last_name,
				email,
			},
			after: {
				name: first_name + ' ' + last_name,
				email,
			},
			reason,
		}

		logger.debug(`Storing log details with session_id: ${sessionId}`)
		await logAction({
			userId: id,
			teamId,
			actionType: method,
			resource,
			details,
			sessionId,
		})

		next()
	} catch (error) {
		logger.error('Error in audit-log middleware:', error)
		next()
	}
}
