import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'

const integrationSchema = {
	getZapierApps: Joi.object().keys({
		search: Joi.string().optional().allow(''),
	}).concat(apiSchema.paginated),
	exchangeNangoHmac: Joi.object().keys({
		slug: Joi.string().required(),
		connection_id: Joi.string().required(),
	}),
	integrationId: Joi.object().keys({
		integration_id: Joi.string().required(),
	}),
}

export default integrationSchema
