import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import { RequestPart } from '../../../types'
import contactSchema from './contact.schema'
import {
	addAttributeToContacts,
	addTagsToContact,
	bulkAddTagsToContacts,
	bulkRemoveTagsFromContacts,
	callContact,
	createBulkContacts,
	createContact,
	deleteBulkContacts,
	deleteContact,
	getAllContactAttributes,
	getAllContactTags,
	getContactCount,
	getContacts,
	removeAttributeFromContacts,
	removeTagsFromContact,
	updateContactInfo,
} from './contact.handlers'
import * as multer from 'multer'
import fileUploadMiddleware from '../../../services/server/middleware/file-upload.middleware'
import { registerOpenApiSchema } from '../../../services/server/openapi'
import { ContactEntity } from '../db/contact.entity'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const contactRouter = Router()

const logDetails = {
	insertContact: {
		method: 'POST',
		reason: 'Request to create new contact',
		resource: 'contact',
	},
	addAttributes: {
		method: 'POST',
		reason: 'Request to add contact attributes',
		resource: 'interview',
	},
	removeAttributeFromContacts: {
		method: 'POST',
		reason: 'Request to remove attributes from contacts',
		resource: 'contacts',
	},
	bulkAddTagsToContacts: {
		method: 'POST',
		reason: 'Request to add multiple tags to contact',
		resource: 'contact',
	},
	bulkRemoveTagsFromContacts: {
		method: 'POST',
		reason: 'Request to remove multiple tags from contacts',
		resource: 'contact',
	},
	addTagsToContact: {
		method: 'POST',
		reason: 'Request to add tags to contact',
		resource: 'contact',
	},
	removeTagsFromContact: {
		method: 'POST',
		reason: 'Request to remove tags from contact',
		resource: 'contact',
	},
	createBulkContacts: {
		method: 'POST',
		reason: 'Request to create multiple new contacts',
		resource: 'contact',
	},
	getContacts: {
		method: 'GET',
		reason: 'Request to get contact',
		resource: 'contact',
	},
	getAllContactTags: {
		method: 'GET',
		reason: 'Request to get all contact tags',
		resource: 'contact',
	},
	getAllContactAttributes: {
		method: 'GET',
		reason: 'Request to get all contact attributes',
		resource: 'contact',
	},
	deleteBulkContacts: {
		method: 'POST',
		reason: 'Request to delete mulptiple contacts',
		resource: 'contact',
	},
	deleteContact: {
		method: 'POST',
		reason: 'Request to delete a contact',
		resource: 'contact',
	},
	getContactCount: {
		method: 'GET',
		reason: 'Request to get contact count',
		resource: 'contact',
	},
	callContact: {
		method: 'POST',
		reason: 'Request to call a contact',
		resource: 'contact',
	},
	updateContactInfo: {
		method: 'POST',
		reason: 'Request to update contact info',
		resource: 'contact',
	},
}

contactRouter.post(
	'/create',
	validator(contactSchema.createContact, RequestPart.BODY),
	auditMiddleware(logDetails.insertContact),
	createContact
)

registerOpenApiSchema({
	method: 'post',
	path: '/contact/create',
	description: 'Create contact',
	validationSchema: [
		{
			schema: contactSchema.createContact,
			requestPart: RequestPart.BODY,
		},
	],
	responseBody: ContactEntity,
})

contactRouter.post(
	'/add_attribute',
	validator(contactSchema.addAttribute, RequestPart.BODY),
	auditMiddleware(logDetails.addAttributes),
	addAttributeToContacts
)

contactRouter.post(
	'/remove_attribute',
	validator(contactSchema.removeAttribute, RequestPart.BODY),
	auditMiddleware(logDetails.removeAttributeFromContacts),
	removeAttributeFromContacts
)

contactRouter.post(
	'/bulk_add_tags',
	validator(contactSchema.bulkModifyTags, RequestPart.BODY),
	bulkAddTagsToContacts
)

contactRouter.post(
	'/bulk_remove_tags',
	validator(contactSchema.bulkModifyTags, RequestPart.BODY),
	auditMiddleware(logDetails.bulkRemoveTagsFromContacts),
	bulkRemoveTagsFromContacts
)

contactRouter.post(
	'/:id/add_tags',
	validator(contactSchema.id, RequestPart.PARAMS),
	validator(contactSchema.tags, RequestPart.BODY),
	auditMiddleware(logDetails.addTagsToContact),
	addTagsToContact
)

contactRouter.post(
	'/:id/remove_tags',
	validator(contactSchema.id, RequestPart.PARAMS),
	validator(contactSchema.tags, RequestPart.BODY),
	auditMiddleware(logDetails.removeTagsFromContact),
	removeTagsFromContact
)

contactRouter.post(
	'/bulk_create',
	multer().array('contacts'),
	fileUploadMiddleware('gcs'),
	(req, res, next) => {
		if (typeof req.body.activeHeaders === 'string') {
			try {
				req.body.activeHeaders = JSON.parse(req.body.activeHeaders)
			} catch (e) {
				return res.status(400).send({ error: 'activeHeaders must be a valid JSON object' })
			}
		}
		if (req.body.tags && typeof req.body.tags === 'string') {
			try {
				req.body.tags = JSON.parse(req.body.tags)
			} catch (e) {
				return res.status(400).send({ error: 'tags must be a valid JSON array' })
			}
		}

		next()
	},
	validator(contactSchema.bulkCreateContacts, RequestPart.BODY),
	auditMiddleware(logDetails.createBulkContacts),
	createBulkContacts
)

contactRouter.get(
	'/',
	validator(contactSchema.getContacts, RequestPart.QUERY),
	auditMiddleware(logDetails.getContacts),
	getContacts
)

contactRouter.get(
	'/all_contact_tags',
	validator(contactSchema.get_contact_tags, RequestPart.QUERY),
	auditMiddleware(logDetails.getAllContactTags),
	getAllContactTags
)

contactRouter.get(
	'/attributes',
	auditMiddleware(logDetails.getAllContactAttributes),
	getAllContactAttributes
)

registerOpenApiSchema({
	method: 'get',
	path: '/contact',
	description: 'Get contacts',
	validationSchema: [
		{
			schema: contactSchema.getContacts,
			requestPart: RequestPart.QUERY,
		},
	],
	responseBody: Array<ContactEntity>,
})

contactRouter.delete(
	'/bulk_delete',
	validator(contactSchema.bulkDeleteContacts, RequestPart.BODY),
	auditMiddleware(logDetails.deleteBulkContacts),
	deleteBulkContacts
)

contactRouter.delete(
	'/:id',
	validator(contactSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.deleteContact),
	deleteContact
)

registerOpenApiSchema({
	method: 'delete',
	path: '/contact/{id}',
	description: 'Delete contact',
	validationSchema: [
		{
			schema: contactSchema.id,
			requestPart: RequestPart.PARAMS,
		},
	],
})

contactRouter.get(
	'/count',
	validator(contactSchema.getContactCount, RequestPart.QUERY),
	auditMiddleware(logDetails.getContactCount),
	getContactCount
)

contactRouter.post(
	'/call',
	validator(contactSchema.callContact, RequestPart.BODY),
	auditMiddleware(logDetails.callContact),
	callContact
)

contactRouter.post(
	'/:id/update_info',
	validator(contactSchema.id, RequestPart.PARAMS),
	validator(contactSchema.updateContactInfo, RequestPart.BODY),
	auditMiddleware(logDetails.updateContactInfo),
	updateContactInfo,
)

registerOpenApiSchema({
	method: 'post',
	path: '/contact/call',
	description: 'Call a contact',
	manualSchema: {
		type: 'object',
		properties: {
			contact_id: {
				type: 'string',
			},
			interview_id: {
				type: 'string',
			},
			metadata: {
				type: 'object',
				properties: {
					additional_data_1: {
						type: 'string',
					},
				},
				nullable: true,
			},
		},
		required: ['contact_id', 'interview_id'],
	},
	responseBody: InterviewResponseEntity,
})
