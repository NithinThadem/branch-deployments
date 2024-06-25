import { Storage } from '@google-cloud/storage'
import { join } from 'path'
import logger from '../../util/logger.util'
import axios, { AxiosRequestConfig } from 'axios'
import { promisify } from 'util'
import { pipeline } from 'stream'

const pipelineAsync = promisify(pipeline)

export const storage = () => new Storage({
	projectId: process.env.GCP_PROJECT_ID,
	keyFilename: join(
		process.cwd(),
		process.env.GCP_SA_KEY_PATH || './service-account.json'
	),
})

export const getPublicUrl = (bucketName: string, fileName: string) =>
	process.env.NODE_ENV === 'production' ?
		`https://cdn.${process.env.FQDN}/${fileName}`
		: `https://storage.googleapis.com/${bucketName}/${fileName}`

const stripPublicUrl = (url: string | null | undefined) => {
	if (typeof url === 'string') {
		return url.split('/').pop()
	}
	return null
}
export const uploadByUrl = async (url: string, extension: string, config?: AxiosRequestConfig) => {
	logger.info(`Uploading file from URL ${url} to GCP bucket ${process.env.GCP_BUCKET_NAME}`)

	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const fileName = `${process.env.NODE_ENV}-${Date.now()}.${extension}`
	const file = bucket.file(fileName)

	const response = await axios.get(url, {
		responseType: 'stream',
		...config,
	})

	await pipelineAsync(response.data, file.createWriteStream())

	await file.makePublic()
	const publicUrl = getPublicUrl(process.env.GCP_BUCKET_NAME, fileName)

	logger.info(`File uploaded successfully. Public URL: ${publicUrl}`)
	return publicUrl
}

export const createUploadStream = (extension: string) => {
	logger.info(`Creating upload stream for ${extension} file to GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(`${process.env.NODE_ENV}-${Date.now()}.${extension}`)
	return {
		file,
		url: getPublicUrl(process.env.GCP_BUCKET_NAME, file.name),
		stream: file.createWriteStream(),
	}
}

export const uploadBase64 = async (extension: string, base64: string) => {
	logger.info(`Uploading ${extension} file to GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(`${process.env.NODE_ENV}-${Date.now()}.${extension}`)
	await file.save(Buffer.from(base64, 'base64'))
	await file.makePublic()
	return getPublicUrl(process.env.GCP_BUCKET_NAME, file.name)
}

export const uploadBinary = async (extension: string, binary: string) => {
	logger.info(`Uploading ${extension} file to GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(`${process.env.NODE_ENV}-${Date.now()}.${extension}`)
	await file.save(binary)
	await file.makePublic()
	return getPublicUrl(process.env.GCP_BUCKET_NAME, file.name)
}

export const uploadFile = async (extension: string, data: Buffer) => {
	logger.info(`Uploading ${extension} file to GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(`${process.env.NODE_ENV}-${Date.now()}.${extension}`)
	await file.save(data)
	await file.makePublic()
	return getPublicUrl(process.env.GCP_BUCKET_NAME, file.name)
}

export const uploadFileByPath = (path: string): Promise<string> => new Promise((resolve, reject) => {
	logger.info(`Uploading file from path ${path} to GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	bucket.upload(path, async (error, file) => {
		if (error) {
			return reject(error)
		}
		await file.makePublic()
		return resolve(getPublicUrl(process.env.GCP_BUCKET_NAME, file.name))
	})
})

export const deleteFile = async (fileUrl: string) => {
	const fileName = stripPublicUrl(fileUrl)
	logger.info(`Deleting ${fileName} file from GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(fileName)
	await file.delete()
}

export const downloadFile = async (fileUrl: string, destinationUrl: string) => {
	const fileName = stripPublicUrl(fileUrl)
	logger.info(`Downloading ${fileName} file from GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(fileName)
	await file.download({ destination: destinationUrl })
}

export const downloadFileStream = async (fileUrl: string) => {
	const fileName = stripPublicUrl(fileUrl)
	logger.info(`Downloading ${fileName} file from GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(fileName)

	const [exists] = await file.exists()
	if (!exists) {
		throw new Error(`File ${fileName} does not exist`)
	}

	return file.createReadStream()
}

export const generateSignedUploadUrl = async (extension: string, contentType: string) => {
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(`${process.env.NODE_ENV}-${Date.now()}.${extension}`)
	const signedUrl = await file.getSignedUrl({
		action: 'write',
		expires: Date.now() + 60 * 1000 * 10, // 10 minutes
		contentType,
	})
	return {
		signedUrl: signedUrl[0],
		uploadedUrl: getPublicUrl(process.env.GCP_BUCKET_NAME, file.name),
	}
}

export const makeFilePublic = async (fileUrl: string) => {
	const fileName = stripPublicUrl(fileUrl)
	logger.info(`Making ${fileName} file public in GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(fileName)
	await file.makePublic()
	return getPublicUrl(process.env.GCP_BUCKET_NAME, file.name)
}

export const getFileMetadata = async (fileUrl: string) => {
	const fileName = stripPublicUrl(fileUrl)
	logger.info(`Getting metadata for ${fileName} file in GCP bucket ${process.env.GCP_BUCKET_NAME}`)
	const bucket = storage().bucket(process.env.GCP_BUCKET_NAME)
	const file = bucket.file(fileName)
	const [metadata] = await file.getMetadata()
	return metadata
}
