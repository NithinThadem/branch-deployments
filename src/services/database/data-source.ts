if (!process.env.DB_TYPE) {
	require('dotenv').config()
}

import logger from '../../util/logger.util'
import { DataSourceOptions, DataSource } from 'typeorm'
import { join } from 'path'
import { NamingStrategy } from './naming-strategy'

const dataSource = (() => {
	let connection: Partial<DataSourceOptions> = {
		port: Number(process.env.DB_PORT),
		database: process.env.DB_DATABASE,
		username: process.env.DB_USERNAME,
		password: process.env.DB_PASSWORD,
		extra: {},
	}

	if (process.env.INSTANCE_CONNECTION_NAME) {
		logger.debug(`Connecting to database using socket: ${process.env.INSTANCE_CONNECTION_NAME}`)
		connection = {
			...connection,
			extra: {
				host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
			},
		}
	} else if (process.env.DB_HOST) {
		logger.debug(`Connecting to database using address: ${process.env.DB_HOST}`)
		connection = {
			...connection,
			host: process.env.DB_HOST,
		}
	} else {
		throw new Error('No database host was found in env!')
	}

	const dataSource = new DataSource({
		...connection,
		type: process.env.DB_TYPE as 'postgres',
		logging: process.env.DB_LOGGING === 'true',
		entities: [
			join(__dirname, '../../modules/**/db/*.entity.*'),
		],
		subscribers: [
			join(__dirname, '../../modules/**/db/*.subscriber.*'),
		],
		migrations: [
			join(__dirname, '../../migrations/*-*.ts'),
		],
		// synchronize: process.env.DB_SYNC === 'true',
		synchronize: false,
		extra: {
			...connection.extra,
			poolSize: process.env.DB_POOL_SIZE,
		},
		maxQueryExecutionTime: 2000,
		namingStrategy: new NamingStrategy(),
	})

	return dataSource
})()

export default dataSource
