require('dotenv').config()
import 'reflect-metadata'
import logger from '../util/logger.util'
import dataSource from '../services/database/data-source'
import { captureError } from '../util/error.util'
import { UserEntity } from '../modules/user/db/user.entity'
import { Batch } from 'mailerlite-api-v2-node/dist/@types'
import axios from 'axios'

logger.info('Exporting users to MailerLite...');

(async () => {
	try {
		await dataSource.initialize()

		const stream = await UserEntity.createQueryBuilder('user')
			.stream()

		let requests: Batch[] = []

		for await (const { user_email, user_first_name, user_last_name } of stream) {
			requests.push({
				method: 'POST',
				path: 'api/subscribers',
				body: {
					email: user_email,
					fields: {
						name: user_first_name,
						last_name: user_last_name,
					},
				},
			})

			if (requests.length === 50) {
				await axios({
					method: 'POST',
					url: 'https://connect.mailerlite.com/api/batch',
					headers: {
						Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
						'Content-Type': 'application/json',
					},
					data: { requests },
				})
				requests = []
			}
		}

		// Send remaining requests if any
		if (requests.length > 0) {
			await axios({
				method: 'POST',
				url: 'https://connect.mailerlite.com/api/batch',
				headers: {
					Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
					'Content-Type': 'application/json',
				},
				data: { requests },
			})
		}

		logger.info('Data export completed successfully.')
	} catch (error) {
		captureError(error)
		logger.error('Error occurred during data export.')
	} finally {
		await dataSource.destroy()
	}
})()
