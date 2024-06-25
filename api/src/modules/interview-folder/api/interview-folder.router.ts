import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import interviewFolderSchema from './interview-folder.schema'
import {
	copyInterviewFolder,
	createInterviewFolder,
	deleteInterviewFolder,
	getAllFolders,
	getInterviewsByFolder,
	moveInterviewsToFolder,
} from './interview-folder.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const interviewFolderRouter = Router()
const logDetails = {
	interviewsByFolder: {
		method: 'GET',
		reason: 'Request to get interview by folder',
		resource: 'interview-folder',
	},
	allFolders: {
		method: 'GET',
		reason: 'Request to get all folders',
		resource: 'interview-folder',
	},
	createInterviewFolder: {
		method: 'POST',
		reason: 'Request to create interview folder',
		resource: 'interview-folder',
	},
	copyInterviewFolder: {
		method: 'POST',
		reason: 'Request to copy interview folder',
		resource: 'interview-folder',
	},
	deleteByInterviewFolder: {
		method: 'DELETE',
		reason: 'Request to delete interview folder',
		resource: 'interview-folder',
	},
	moveInterviewsToFolder: {
		method: 'POST',
		reason: 'Request to move interview in folder',
		resource: 'interview-folder',
	},
}

interviewFolderRouter.get(
	'/',
	validator(interviewFolderSchema.get_interviews, RequestPart.PARAMS),
	auditMiddleware(logDetails.interviewsByFolder),
	getInterviewsByFolder
)

interviewFolderRouter.get(
	'/folders',
	validator(interviewFolderSchema.get_folders, RequestPart.PARAMS),
	auditMiddleware(logDetails.allFolders),
	getAllFolders,
)

interviewFolderRouter.post(
	'/',
	validator(interviewFolderSchema.createFolder, RequestPart.BODY),
	auditMiddleware(logDetails.createInterviewFolder),
	createInterviewFolder
)

interviewFolderRouter.post(
	'/folder/:folder_id/copy',
	validator(interviewFolderSchema.copyFolder, RequestPart.BODY),
	auditMiddleware(logDetails.copyInterviewFolder),
	copyInterviewFolder
)

interviewFolderRouter.delete(
	'/folder/:folder_id',
	validator(interviewFolderSchema.folder_id, RequestPart.PARAMS),
	auditMiddleware(logDetails.deleteByInterviewFolder),
	deleteInterviewFolder
)

interviewFolderRouter.post(
	'/folder/:folder_id/move_interview',
	validator(interviewFolderSchema.folder_id, RequestPart.PARAMS),
	validator(interviewFolderSchema.interview_id, RequestPart.BODY),
	auditMiddleware(logDetails.moveInterviewsToFolder),
	moveInterviewsToFolder
)

