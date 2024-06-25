require('dotenv').config()
import 'reflect-metadata'
import logger from '../util/logger.util'
import dataSource from '../services/database/data-source'
import { InterviewResponseEntity } from '../modules/interview-response/db/interview-response.entity'
import { captureError } from '../util/error.util'
import { createWriteStream } from 'fs'

logger.info(`Exporting fine-tuning data from ${process.env.NODE_ENV} environment...`);

(async () => {
	try {
		await dataSource.initialize()

		const stream = await InterviewResponseEntity.createQueryBuilder('response')
			.where('jsonb_array_length(response.conversation_history) > 4')
			.stream()

		const fileStream = createWriteStream('fine_tuning_data.jsonl', { flags: 'a' })

		for await (const { response_conversation_history } of stream) {
			fileStream.write(JSON.stringify(response_conversation_history.map(i => ({
				author: i.author,
				text: i.text,
			}))) + '\n')
		}

		fileStream.end()

		logger.info('Data export completed successfully.')
	} catch (error) {
		captureError(error)
		logger.error('Error occurred during data export.')
	}
})()
