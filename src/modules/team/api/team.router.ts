import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import teamSchema from './team.schema'
import {
	createTeamHandler,
	createTeamOnboarding,
	deleteUserFromTeam,
	getTeam,
	getTeamDataPoints,
	getTwilioA2PCampaignUsecases,
	inviteUser,
	submitBusinessMetadataForReview,
	updateTeam,
	createContactView,
	deleteContactView,
	updateContactView,
	getContactViews,
	uploadTeamLogo,
} from './team.handlers'
import * as multer from 'multer'
import fileUploadMiddleware from '../../../services/server/middleware/file-upload.middleware'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const teamRouter = Router()
const logDetails = {
	createTeamOnboarding: {
		method: 'POST',
		reason: 'Request to create team onboarding',
		resource: 'team',
	},
	getTeamDataPoints: {
		method: 'GET',
		reason: 'Request to get team data points',
		resource: 'team',
	},
	getTeam: {
		method: 'GET',
		reason: 'Reques to get team',
		resource: 'team',
	},
	inviteUser: {
		method: 'POST',
		reason: 'Request to invite user',
		resource: 'team',
	},
	updateTeam: {
		method: 'UPDATE',
		reason: 'Request to update team',
		resource: 'team',
	},
	deleteUserFromTeam: {
		method: 'POST',
		reason: 'Request to delete user from team',
		resource: 'team',
	},
	uploadTeamLogo: {
		method: 'POST',
		reason: 'Request to upload team logo',
		resource: 'team',
	},
	submitBusinessMetadataForReview: {
		method: 'POST',
		reason: 'Request to submit metadata for review',
		resource: 'team',
	},
}

teamRouter.post(
	'/create',
	validator(teamSchema.create, RequestPart.BODY),
	createTeamHandler
)

teamRouter.post(
	'/onboarding',
	validator(teamSchema.onboarding, RequestPart.BODY),
	auditMiddleware(logDetails.createTeamOnboarding),
	createTeamOnboarding
)

teamRouter.get(
	'/data_points',
	validator(teamSchema.dataPointsQuery, RequestPart.QUERY),
	auditMiddleware(logDetails.getTeamDataPoints),
	getTeamDataPoints
)

teamRouter.get(
	'/',
	auditMiddleware(logDetails.getTeam),
	getTeam
)

teamRouter.post(
	'/invite',
	validator(teamSchema.inviteUser, RequestPart.BODY),
	auditMiddleware(logDetails.inviteUser),
	inviteUser
)

teamRouter.patch(
	'/',
	validator(teamSchema.updateTeam, RequestPart.BODY),
	auditMiddleware(logDetails.updateTeam),
	updateTeam
)

teamRouter.post(
	'/remove_user',
	validator(teamSchema.deleteUser, RequestPart.BODY),
	auditMiddleware(logDetails.deleteUserFromTeam),
	deleteUserFromTeam
)

teamRouter.post(
	'/upload_logo',
	multer().single('logo'),
	fileUploadMiddleware('gcs'),
	auditMiddleware(logDetails.uploadTeamLogo),
	uploadTeamLogo
)

teamRouter.post(
	'/submit_business_metadata',
	validator(teamSchema.submitBusinessMetadata, RequestPart.BODY),
	auditMiddleware(logDetails.submitBusinessMetadataForReview),
	submitBusinessMetadataForReview
)

teamRouter.get(
	'/get_a2p_campaign_usecases',
	getTwilioA2PCampaignUsecases,
)

teamRouter.post(
	'/contact_views',
	validator(teamSchema.createContactView, RequestPart.BODY),
	createContactView
)

teamRouter.delete(
	'/contact_views',
	validator(teamSchema.deleteContactView, RequestPart.BODY),
	deleteContactView
)

teamRouter.patch(
	'/contact_views',
	validator(teamSchema.updateContactView, RequestPart.BODY),
	updateContactView
)

teamRouter.get(
	'/contact_views',
	getContactViews
)
