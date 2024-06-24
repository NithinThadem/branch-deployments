import { Router, Request, Response } from 'express'
import { EventMap, handleEvent } from '../../services/event'
import logger from '../../util/logger.util'
// import response from '../../services/server/response'
// import { OAuth2Client } from 'google-auth-library'

type PubSubData = {
	eventName: keyof EventMap
	args: any
	token: string
}

// let authClient: OAuth2Client

export const pubsubRouter = Router()

pubsubRouter.post(
	'/',
	async (req: Request, res: Response) => {
		// try {
		// 	if (!authClient) {
		// 		authClient = new OAuth2Client()
		// 	}

		// 	const bearer = req.header('Authorization')
		// 	const [, token] = bearer.match(/Bearer (.*)/)
		// 	const ticket = await authClient.verifyIdToken({
		// 		idToken: token,
		// 	})
		// 	const claim = ticket.getPayload()

		// 	if (!claim.email_verified || claim.email !== process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL) {
		// 		return response({ res, status: 400, error: 'Invalid signature' })
		// 	}
		// } catch (error) {
		// 	return response({ res, status: 400, error })
		// }

		const data = JSON.parse(Buffer.from(req.body.message.data, 'base64').toString()) as PubSubData
		logger.debug(`Pub/Sub data: ${JSON.stringify(data, null, 2)}`)

		// if (data.token !== process.env.PUBSUB_TOKEN) {
		// 	return response({ res, status: 401, error: 'Unauthorized' })
		// }

		await handleEvent(data.eventName, data.args)
		return res.status(200).send()
	}
)
