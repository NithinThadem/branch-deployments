import MailerLite from 'mailerlite-api-v2-node'
import logger from '../../util/logger.util'

const client = () => MailerLite(process.env.MAILERLITE_API_KEY)

export const createSubscriber = async (args: {
	email: string
	firstName: string
	lastName: string
}) => {
	if (!process.env.MAILERLITE_API_KEY) {
		logger.warn('MAILERLITE_API_KEY not set, skipping subscriber creation')
	}

	const response = await client().addSubscriber({
		email: args.email,
		name: args.firstName,
		fields: {
			last_name: args.lastName,
		},
	})
	return response
}
