/* eslint-disable max-len */
import axios from 'axios'
import { IntegrationEntity } from '../../modules/integration/db/integration.entity'
import * as moment from 'moment-timezone'
import logger from '../../util/logger.util'
import nango from '../nango'
import { captureError } from '../../util/error.util'
import { getLocationAccessToken } from '../../modules/integration/db/apps/highlevel.integration'
import { TriggerEntity } from '../../modules/trigger/db/trigger.entity'

interface GHLAvailableTime {
	date: string
	times: moment.Moment[]
}

interface GHLGetTimesArgs {
    calendarId: string
    timezone: string
    integrationId: string
	ghlLocationId: string
}

interface GHLCreateContactArgs {
	integration?: IntegrationEntity
	integrationId?: string
	email: string
	name: string
	phone?: string
	timezone?: string
	ghlLocationId?: string
}

interface GHLCreateAppointmentArgs {
	integration: IntegrationEntity
	contact: GHLContact
	calendarId: string
	date: moment.Moment
	ghlLocationId: string
}

export interface GHLContact {
	id: string
	name: string
	locationId: string
	firstName?: string
	lastName?: string
	email: string
	timezone?: string
	phone?: string
	dnd: boolean
}

interface GetContactParams {
	trigger?: TriggerEntity;
	integration?: IntegrationEntity;
	id: string;
	locationId?: string;
}

/**
 * Get the closest available time for a GHL calendar
 */
const getClosestAvailableTime = async ({ calendarId, timezone, integrationId, ghlLocationId }: GHLGetTimesArgs, time: moment.Moment): Promise<moment.Moment | null> => {
	try {
		const availableTimes = await getAvailableTimes({ calendarId, timezone, integrationId, ghlLocationId })
		const availableTimesFlat = availableTimes.flatMap((availableTime) => availableTime.times)
		const closestTime = availableTimesFlat.reduce((prev, curr) => {
			const prevDiff = Math.abs(moment(time).diff(prev))
			const currDiff = Math.abs(moment(time).diff(curr))
			return prevDiff < currDiff ? prev : curr
		}, availableTimesFlat[0])

		return closestTime
	} catch (error) {
		logger.error(`Error getting closest available time for GHL calendar ${calendarId}`)
		return null
	}
}

/**
 * Get available times for a GHL calendar
 */
const getAvailableTimes = async ({ calendarId, timezone, integrationId, ghlLocationId }: GHLGetTimesArgs): Promise<GHLAvailableTime[]> => {
	try {
		const integration = await IntegrationEntity.findOne({ where: { id: integrationId } })
		const forwardDays = 10
		const startDate = new Date()
		startDate.setDate(startDate.getDate() - 2)
		let accessToken

		const endDate = new Date()
		endDate.setDate(endDate.getDate() + forwardDays)

		const params: Record<string, any> = {
			timezone,
			startDate: startDate.valueOf(),
			endDate: endDate.valueOf(),
		}

		const query = new URLSearchParams(params).toString()

		const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)

		if (integration.auth_metadata.nango_connection_config.locationId) {
			accessToken = connection.credentials.raw.access_token
			logger.info('Using stored access token from integration metadata')
		} else {
			logger.info('Location ID not found in integration metadata, fetching location-specific access token', { ghlLocationId })
			accessToken = await getLocationAccessToken(connection.credentials.raw.access_token, integration.auth_metadata.nango_connection_config.companyId, ghlLocationId)
		}

		const response = await axios.get(`https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?${query}`, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Version: '2021-04-15',
			},
		})

		const availableTimeSlots: GHLAvailableTime[] = []
		Object.keys(response.data).forEach(day => {
			try {
				availableTimeSlots.push({
					date: moment(day).format('YYYY-MM-DD'),
					times: response.data[day].slots.map((time: string) => moment(time).tz(timezone)),
				})
			} catch {
				return
			}
		})

		return availableTimeSlots
	} catch (error) {
		captureError(error)
		logger.error(`Error getting available times for GHL calendar ${calendarId}`)
		return []
	}
}

/**
 * Helper function to format available times into a prompt
 *
 * @param availableTimes the available times to format into a prompt
 * @param timezone the timezone to format the available times in
 * @returns { string } prompt
 */
const formatTimes = (availableTimes: GHLAvailableTime[], timezone: string): string => {
	let prompt = '**HighLevel Calendar Available Times**\n'
	availableTimes.forEach((availableTime) => {
		const formattedDate = moment(availableTime.date).format('dddd, MMMM Do YYYY')
		prompt += `\nOn ${formattedDate}:\n`
		availableTime.times.forEach((time) => {
			try {
				const formattedTime = moment(time).tz(timezone || 'America/New_York').format('h:mm A')
				prompt += `\t${formattedTime}\n`
			} catch (error) {
				captureError(error)
			}
		})
	})
	return prompt
}

/**
 * Get a contact on a GHL account
 */
export const getContact = async ({ trigger, integration, id, locationId }: GetContactParams): Promise<GHLContact> => {
	try {
		let accessToken
		let connection

		if (trigger) {
			connection = await nango.getConnection('highlevel', trigger.integration.auth_metadata.nango_connection_id)
			if (trigger.integration.auth_metadata.nango_connection_config.locationId || !locationId) {
				accessToken = connection.credentials.raw.access_token
				logger.info('Using stored access token from trigger metadata')
			} else {
				accessToken = await getLocationAccessToken(
					connection.credentials.raw.access_token,
					trigger.integration.auth_metadata.nango_connection_config.companyId,
					locationId
				)
			}
		} else {
			connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)
			if (integration.auth_metadata.nango_connection_config.locationId || !locationId) {
				accessToken = connection.credentials.raw.access_token
				logger.info('Using stored access token from integration metadata')
			} else {
				accessToken = await getLocationAccessToken(
					connection.credentials.raw.access_token,
					integration.auth_metadata.nango_connection_config.companyId,
					locationId
				)
			}
		}

		const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${id}`, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Version: '2021-04-15',
			},
		})

		return response.data.contact as GHLContact
	} catch (error) {
		captureError(`Error fetching GHL contact with id ${id}`)
		return null
	}
}
/**
 * Create or fetch a contact on a GHL account
 */
const createContact = async ({ integration, integrationId, email, name, phone, timezone, ghlLocationId }: GHLCreateContactArgs): Promise<GHLContact> => {
	try {
		let accessToken

		if (!integration) {
			integration = await IntegrationEntity.findOne({ where: { id: integrationId } })
		}

		const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)
		if (integration.auth_metadata.nango_connection_config.locationId) {
			accessToken = connection.credentials.raw.access_token
			logger.info('Using stored access token from integration metadata')
		} else {
			logger.info('Location ID not found in integration metadata, fetching location-specific access token', { ghlLocationId })
			accessToken = await getLocationAccessToken(connection.credentials.raw.access_token, integration.auth_metadata.nango_connection_config.companyId, ghlLocationId)
		}

		const response = await axios.post('https://services.leadconnectorhq.com/contacts/upsert', {
			email,
			firstName: name.split(' ')[0],
			lastName: name.split(' ')[1],
			phone,
			timezone,
			locationId: ghlLocationId,
		}, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Version: '2021-04-15',
			},
		})

		return response.data.contact as GHLContact
	} catch (error) {
		captureError(`Error creating or fetching GHL contact for email ${email}`)
		return null
	}
}

/**
 * Create an appointment for a contact on a GHL calendar
 */
const createAppointment = async ({ integration, contact, calendarId, date, ghlLocationId }: GHLCreateAppointmentArgs): Promise<boolean> => {
	try {
		let accessToken
		const connection = await nango.getConnection('highlevel', integration.auth_metadata.nango_connection_id)
		if (integration.auth_metadata.nango_connection_config.locationId) {
			accessToken = connection.credentials.raw.access_token
		} else {
			logger.info('Location ID not found in integration metadata, fetching location-specific access token', { ghlLocationId })
			accessToken = await getLocationAccessToken(connection.credentials.raw.access_token, integration.auth_metadata.nango_connection_config.companyId, ghlLocationId)
		}

		const appointmentData = {
			calendarId,
			contactId: contact.id,
			locationId: ghlLocationId,
			startTime: date.toISOString(),
		}

		await axios.post('https://services.leadconnectorhq.com/calendars/events/appointments', appointmentData, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Version: '2021-04-15',
				'Content-Type': 'application/json',
			},
		})

		return true
	} catch (error) {
		captureError(error)
		return false
	}
}

const ghl = {
	getClosestAvailableTime,
	getAvailableTimes,
	formatTimes,
	getContact,
	createContact,
	createAppointment,
}

export default ghl
