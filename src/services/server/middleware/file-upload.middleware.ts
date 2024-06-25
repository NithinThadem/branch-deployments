import { getPublicUrl, storage } from '../../google/storage'
import { NextFunction, Response } from 'express'
import { FileUploadRequest } from '../../../types'
import * as path from 'path'
import * as fs from 'fs'
import * as mime from 'mime'
import logger from '../../../util/logger.util'

const fileUploadMiddleware = (destination: 'gcs' | 'cache') => (req, res, next) => {
	switch (destination) {
		case 'gcs':
			return fileUploadToGCSMiddleware(req, res, next)
		case 'cache':
			return fileUploadToCacheMiddleware(req, res, next)
		default:
			return next()
	}
}

export default fileUploadMiddleware

export const deleteFileFromGCS = (url: string) => {
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const fileName = url.split('/').pop()
	return bucket.file(fileName).delete()
}

const fileUploadToGCSMiddleware = (req: FileUploadRequest, res: Response, next: NextFunction) => {
	if (!req.files && req.file) {
		req.files = [req.file]
	}

	if (!req.files) {
		logger.info('No files to upload')
		return next()
	}

	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)

	const uploadPromises = req.files.map(async (uploadedFile) => {
		if (!uploadedFile) {
			return
		}

		const fileName = `${process.env.NODE_ENV}-${Date.now()}-${uploadedFile.originalname}`.replace(/\s/g, '')
		const file = bucket.file(fileName)

		const stream = file.createWriteStream({
			metadata: {
				contentType: uploadedFile.mimetype,
			},
		})

		stream.on('error', (error) => {
			throw error
		})

		return new Promise<void>((resolve, reject) => {
			stream.on('finish', () => {
				file.makePublic()
					.then(() => {
						uploadedFile.url = getPublicUrl(process.env.GCP_BUCKET_NAME, fileName)
						logger.info(`Uploaded file to ${uploadedFile.url}`)

						resolve()
					})
					.catch((err) => reject(err))
			})

			stream.end(uploadedFile.buffer)
		})
	})

	Promise.all(uploadPromises)
		.then(() => {
			next()
		})
		.catch((error) => {
			throw error
		})

	return Promise.all(uploadPromises)
}

const fileUploadToCacheMiddleware = (req: FileUploadRequest, res: Response, next: NextFunction) => {
	if (!req.files) {
		return next()
	}

	const cachePath = path.join(process.cwd(), './cache')

	if (!fs.existsSync(cachePath)) {
		fs.mkdirSync(cachePath, { recursive: true })
	}

	const uploadPromises = req.files.map(async (uploadedFile) => {
		if (!uploadedFile) {
			return
		}

		const fileName = `${process.env.NODE_ENV}-${Date.now()}-${uploadedFile.originalname}`.replace(/\s/g, '')
		const filePath = path.join(cachePath, fileName)

		const stream = fs.createWriteStream(filePath)
		stream.write(uploadedFile.buffer)
		stream.end()

		stream.on('error', (error) => {
			throw error
		})

		return new Promise<void>((resolve, reject) => {
			stream.on('finish', () => {
				uploadedFile.name = fileName
				uploadedFile.path = filePath
				uploadedFile.type = mime.getType(filePath)
				uploadedFile.url = filePath

				uploadedFile.delete = () => {
					fs.unlink(filePath, (err) => {
						if (err) {
							throw err
						}
					})
				}

				resolve()
			})

			stream.on('error', (error) => {
				reject(error)
			})
		})
	})

	Promise.all(uploadPromises)
		.then(() => {
			next()
		})
		.catch((error) => {
			throw error
		})

	return Promise.all(uploadPromises)
}

export const asyncMiddleware = (fn) => (req, res, next) => {
	Promise.resolve(fn(req, res, next)).catch(next)
}
