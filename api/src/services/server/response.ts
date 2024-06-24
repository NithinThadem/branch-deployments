import { Response } from 'express'
import logger from '../../util/logger.util'

type args = {
	status?: number;
	data?: any;
	res: Response
	error?: any
	caught?: boolean
}

const response = ({
	res,
	data = null,
	status = 200,
	error = null,
	caught = false, // caught async from app.ts
}: args) => {
	const response = res

	if (error) {
		logger.error(`Response error: ${JSON.stringify({
			request_id: response.req?.id,
			method: response.req?.method,
			url: response.req?.originalUrl,
			sentry_event_id: response.sentry,
			error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
		}, null, 2)}`)
	}

	return res
		.status((error && status < 300) ? 400 : status)
		.send({
			data,
			error: caught ? response.sentry : error,
		})
}

export default response
