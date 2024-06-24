import { AuditLogEntity } from './audit-log.entity'

export type AuditLogType = {
    userId: string,
    teamId: string,
    actionType: string,
    resource: string,
    details: object,
    sessionId: string
}

export async function logAction(auditLog: AuditLogType) {
	const { userId, teamId, actionType, resource, details, sessionId } = auditLog
	const audit = AuditLogEntity.create({
		user_id: userId,
		team_id: teamId,
		action_type: actionType,
		resource,
		details,
		session_id: sessionId,
	})

	await audit.save()
}
