import * as Joi from 'joi'
import apiSchema from '../../../services/server/api.schema'
import { enumToJoiSchema } from '../../../util/helpers.util'
import { GeniusSourceType } from '../../genius-source/db/genius-source.types'

const geniusSchema = {
	id: Joi.object().keys({
		id: Joi.string().required(),
	}),
	getDataSources: Joi.object().keys({
		search: Joi.string().optional().allow(''),
	}).concat(apiSchema.paginated),
	createDatabase: Joi.object().keys({
		name: Joi.string().required(),
	}),
	updateDatabase: Joi.object().keys({
		name: Joi.string().required(),
	}),
	uploadTextSource: Joi.object().keys({
		name: Joi.string().required(),
		content: Joi.string().required(),
	}),
	sourceIds: Joi.object().keys({
		source_ids: Joi.array().items(Joi.string().required()).required(),
	}),
	uploadFileSource: Joi.object().keys({
		type: enumToJoiSchema(GeniusSourceType).required(),
		names: Joi.array().items(Joi.string().required()).required(),
	}),
	uploadUrlSource: Joi.object().keys({
		name: Joi.string().required(),
		url: Joi.string().uri().required(),
	}),
}

export default geniusSchema
