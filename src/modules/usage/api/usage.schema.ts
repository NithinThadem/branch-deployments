import * as Joi from 'joi'

const usageSchema = {
	getUsage: Joi.object().keys({
		time_frame: Joi.string().valid('day', 'week', 'month').optional(),
	}),
}

export default usageSchema
