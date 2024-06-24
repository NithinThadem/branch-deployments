import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import * as multer from 'multer'
import fileUploadMiddleware from '../../../services/server/middleware/file-upload.middleware'
import geniusSchema from './genius.schema'
import {
	createGeniusDatabase,
	deleteGeniusDataSources,
	deleteGeniusDatabase,
	getGeniusDatabases,
	getGeniusDataSources,
	updateGeniusDatabase,
	uploadTextSource,
	uploadFileSource,
	uploadUrlSource,
} from './genius.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const geniusRouter = Router()

const logDetails = {
	getGeniusDatabase: {
		method: 'GET',
		reason: 'Request to get genius databases',
		resource: 'genius',
	},
	createGeniusDatabase: {
		method: 'POST',
		reason: 'Request create new genius database',
		resource: 'genius',
	},
	updateGeniusDatabase: {
		method: 'POST',
		reason: 'Request to update genius database',
		resource: 'genius',
	},
	getGeniusDataSource: {
		method: 'GET',
		reason: 'Request to get get genius datasource',
		resource: 'genius',
	},
	uploadTextSource: {
		method: 'POST',
		reason: 'Request upload text source',
		resource: 'genius',
	},
	deleteGeniusDatabase: {
		method: 'POST',
		reason: 'Request ot delete genius database',
		resource: 'genius',
	},
	deleteGeniusDataSources: {
		method: 'POST',
		reason: 'request to delete genius datasources',
		resource: 'genius',
	},
	uploadFileSource: {
		method: 'POST',
		reason: 'Request to upload file source',
		resource: 'genius',
	},
	uploadUrlSource: {
		method: 'POST',
		reason: 'Request to upload url source',
		resource: 'genius',
	},
}

geniusRouter.get(
	'/',
	auditMiddleware(logDetails.getGeniusDatabase),
	getGeniusDatabases
)

geniusRouter.post(
	'/create',
	validator(geniusSchema.createDatabase, RequestPart.BODY),
	auditMiddleware(logDetails.createGeniusDatabase),
	createGeniusDatabase
)

geniusRouter.post(
	'/:id/update',
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.updateDatabase, RequestPart.BODY),
	auditMiddleware(logDetails.updateGeniusDatabase),
	updateGeniusDatabase
)

geniusRouter.get(
	'/:id/sources',
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.getDataSources, RequestPart.QUERY),
	auditMiddleware(logDetails.getGeniusDataSource),
	getGeniusDataSources
)

geniusRouter.post(
	'/:id/sources/upload_text',
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.uploadTextSource, RequestPart.BODY),
	auditMiddleware(logDetails.uploadTextSource),
	uploadTextSource
)

geniusRouter.post(
	'/:id/delete',
	validator(geniusSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.deleteGeniusDatabase),
	deleteGeniusDatabase
)

geniusRouter.post(
	'/:id/sources/delete',
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.sourceIds, RequestPart.BODY),
	auditMiddleware(logDetails.deleteGeniusDataSources),
	deleteGeniusDataSources
)

geniusRouter.post(
	'/:id/sources/upload_file',
	multer().array('files'),
	(req, res, next) => {
		if (!req.files || req.files.length === 0) {
			return res.status(400).send({ error: '"files" is required' })
		}
		next()
	},
	fileUploadMiddleware('gcs'),
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.uploadFileSource, RequestPart.BODY),
	auditMiddleware(logDetails.uploadFileSource),
	uploadFileSource
)

geniusRouter.post(
	'/:id/sources/upload_url',
	validator(geniusSchema.id, RequestPart.PARAMS),
	validator(geniusSchema.uploadUrlSource, RequestPart.BODY),
	auditMiddleware(logDetails.uploadUrlSource),
	uploadUrlSource
)
