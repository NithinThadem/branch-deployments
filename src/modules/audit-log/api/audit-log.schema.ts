import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'

const auditLogSchema: any = {
	get_audit_logs: Joi.object().keys({
		user_id: Joi.string().optional().allow(''),
		search: Joi.string().optional().allow(''),
		action_type: Joi.string().optional().allow(''),
		sort_by: Joi.string().valid('timestamp_ASC', 'timestamp_DESC').optional(),
	}).concat(apiSchema.paginated),
}

export default auditLogSchema
