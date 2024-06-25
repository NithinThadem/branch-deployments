import * as joi from 'joi'
import { RequestPart } from '../../../types'
import response from '../response'

const validator = (schema: joi.Schema, key: RequestPart) => (req, res, next) => {
	const toValidate = key === 'file' ? { resume: req.file } : req[key]
	const { error } = schema.validate(toValidate, {
		abortEarly: false,
	})
	if (!error) {
		return next()
	}
	const { details } = error
	const message = details.map(i => i.message).join(',')
	return response({
		res,
		status: 400,
		error: message,
	})
}

export default validator
