import axios from 'axios'
import logger from '../../util/logger.util'
import { ContactData } from './types'
import { TransactionalEmail } from './emails.enums'

const BASE_URL = 'https://app.loops.so/api/v1'
const HEADERS = {
	Authorization: `Bearer ${process.env.LOOPS_API_KEY}`,
	'Content-Type': 'application/json',
}

export const createContact = async (contactData: ContactData) => {
	const url = `${BASE_URL}/contacts/create`
	const response = await axios.post(url, contactData, { headers: HEADERS })
	return response.data
}

export const updateContact = async (contactData: ContactData) => {
	const url = `${BASE_URL}/contacts/update`
	const response = await axios.post(url, contactData, { headers: HEADERS })
	return response.data
}

export const deleteContact = async (email: string) => {
	const url = `${BASE_URL}/contacts/delete`
	const body = { email }
	const response = await axios.post(url, body, { headers: HEADERS })
	return response.data
}

export const sendEventToLoops = async (userEmail: string, eventName: string) => {
	const url = `${BASE_URL}/events/send`
	const body = {
		email: userEmail,
		eventName: eventName,
	}
	const response = await axios.post(url, body, { headers: HEADERS })
	return response.data
}

export const sendTransactionalEmail = async (args: {
	email: string
	type: TransactionalEmail
	data?: Record<string, any>
}) => {
	const url = `${BASE_URL}/transactional`

	const body = {
		email: args.email,
		transactionalId: args.type,
		dataVariables: args.data,
	}

	try {
		const response = await axios.post(url, body, { headers: HEADERS })
		logger.info('Email sent, response:', response.data)

		return response.data
	} catch (error) {
		logger.error('Error sending email:', error.response ? error.response.data : error.message)
		throw error
	}
}

