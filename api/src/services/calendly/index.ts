/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-len */
import { Browser } from 'puppeteer'
import puppeteer from 'puppeteer-extra'
import logger from '../../util/logger.util'
import * as querystring from 'querystring'
import axios from 'axios'
import * as moment from 'moment-timezone'
import { isProduction } from '../../util/env.util'
import { captureError } from '../../util/error.util'
import { withExponentialBackoff } from '../../util/helpers.util'
import { AxiosResponse } from 'axios'

export const launchCalendlyPage = async (url: string, timezone: string): Promise<Browser> => {
	logger.debug(`Launching Calendly URL: ${url}`)

	puppeteer.use(require('puppeteer-extra-plugin-stealth')())

	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
		timeout: 0,
		headless: isProduction() ? 'new' : false,
		defaultViewport: {
			width: 1080,
			height: 1024,
		},
		env: {
			TZ: timezone,
		},
		devtools: !isProduction(),
	})

	const page = await browser.newPage()
	await page.setRequestInterception(true)

	page.on('request', (request) => {
		if (request.resourceType() === 'script' && !request.url().includes('calendly')) {
			request.abort()
		} else if (request.url().includes('notifier-configs.airbrake.io')) {
			request.abort()
		} else if (request.resourceType() === 'image') {
			request.abort()
		} else {
			request.continue()
		}
	})

	await page.goto(url, { waitUntil: 'networkidle2' })

	page.on('console', msg => logger.debug(`Puppeeteer console: ${msg.text()}`))

	logger.debug('Page loaded')

	return browser
}

interface CalendlyAvailableTime {
	date: string
	times: moment.Moment[]
}

interface GetAvailableTimesArgs {
	url: string
	timezone?: string
	forwardDays?: number
}

export const getAvailableTimes = async ({
	url,
	timezone,
	forwardDays,
}: GetAvailableTimesArgs): Promise<CalendlyAvailableTime[]> => {
	if (url.endsWith('/')) {
		url = url.substring(0, url.length - 1)
	}
	const splitUrlStrings = url.split('/')
	const profileName = splitUrlStrings[splitUrlStrings.length - 2]
	const eventName = splitUrlStrings[splitUrlStrings.length - 1]
	const uuid: string = await getUUIDForEvent(profileName, eventName)
	if (!timezone) {
		throw Error('No timezone provided')
	}
	return getAvailableTimesForEvent(uuid, timezone, forwardDays || 7, url)
}

const getUUIDForEvent = async (profileName: string, eventName: string): Promise<string> => {
	const axios = require('axios')

	const apiUrl = `https://calendly.com/api/booking/profiles/${profileName}/event_types/${eventName}`

	const config = {
		method: 'get',
		maxBodyLength: Infinity,
		url: apiUrl,
	}

	const response: AxiosResponse<EventApiResponse> = await withExponentialBackoff<AxiosResponse>(async () => await axios.request(config))
	if (response.status === 200) {
		const data: EventApiResponse = response.data
		return data.uuid
	}

	return ''
}

const getAvailableTimesForEvent = async (eventUUID: string, timezone: string, forwardDays: number, url?: string): Promise<CalendlyAvailableTime[]> => {
	try {
		const startDate = new Date()
		startDate.setDate(startDate.getDate() - 2)

		const endDate = new Date()
		endDate.setDate(endDate.getDate() + forwardDays)

		const params = {
			timezone: timezone,
			diagnostics: 'false',
			range_start: startDate.toISOString().substring(0, 10),
			range_end: endDate.toISOString().substring(0, 10),
		}

		const config = {
			method: 'get',
			maxBodyLength: Infinity,
			url: `https://calendly.com/api/booking/event_types/${eventUUID}/calendar/range?${querystring.stringify(params)}`,
		}

		const response = await axios.request(config)

		const availableTimeSlots: CalendlyAvailableTime[] = []

		if (response.status === 200) {
			const data: RangeApiResponse = response.data
			data.days.forEach((entry) => {
				if (entry.status === 'available') {
					availableTimeSlots.push({
						date: moment(entry.date).format('YYYY-MM-DD'),
						times: entry.spots.map(spot => moment(spot.start_time).tz(timezone)),
					})
				}
			})
		}

		return availableTimeSlots
	} catch (error) {
		// TODO notify user
		logger.error(`Error getting Calendly times from ${url}`)
		return []
	}
}

interface CalendlyScheduleArgs {
	browser: Browser
	url: string
	time: moment.Moment
	name: string
	email: string
	phone: string
	details?: string
}

interface Spot {
	status: string;
	start_time: string;
	invitees_remaining: number;
}

interface Day {
	date: string;
	status: string;
	spots: Spot[];
	invitee_events: any[];
}

interface RangeApiResponse {
	invitee_publisher_error: boolean;
	today: string;
	availability_timezone: string;
	days: Day[];
	diagnostic_data: null;
	// current_user: CurrentUser;
}

interface EventApiResponse {
	uuid: string;
}

export const scheduleTime = async (args: CalendlyScheduleArgs): Promise<void> => {
	const pages = await args.browser.pages()
	const page = pages[pages.length - 1]

	const monthSelector = 'div[data-testid="title"]'
	await page.waitForSelector(monthSelector)
	await new Promise((resolve) => setTimeout(resolve, 3000))

	const dateToSelect = args.time.format('D')
	const monthToSelect = args.time.format('MMMM')

	const monthNavigationButtons = await page.$$('[data-testid="calendar-header"] button')
	if (monthNavigationButtons.length < 2) {
		throw new Error('Navigation buttons not found')
	}

	const nextMonthButton = monthNavigationButtons[1]
	const lang = await page.evaluate(() => document.documentElement.lang)

	let monthFound = false
	while (!monthFound) {
		const currentMonthYear = await page.$eval(monthSelector, element => element.textContent)
		if (!currentMonthYear) {
			throw Error('Month and year not found')
		}

		const [currentMonthIntl] = currentMonthYear.split(' ')

		const currentMonth = moment()
			.locale(lang)
			.month(currentMonthIntl)
			.locale('en')
			.format('MMMM')

		if (currentMonth === monthToSelect) {
			monthFound = true
			continue
		}

		await nextMonthButton.click()
		await new Promise((resolve) => setTimeout(resolve, 3000))
	}

	await page.evaluate(() => {
		const bookingContainer = document.querySelector('[data-container="booking-container"]')
		bookingContainer?.scrollIntoView({ behavior: 'smooth', block: 'end' })
	})
	await new Promise((resolve) => setTimeout(resolve, 1500))

	const dateFound = await page.evaluate((dateToSelect) => {
		const tds = Array.from(document.querySelectorAll('td[role="gridcell"][aria-selected]'))

		const dateElement = tds.find(td => td.textContent === dateToSelect)
		if (dateElement) {
			const button = dateElement.querySelector('button')
			if (button) {
				button.click()
				return true
			}
			return false
		}
	}, dateToSelect)

	if (dateFound === false) {
		throw new Error('Date not available')
	}

	await new Promise((resolve) => setTimeout(resolve, 3000))
	const timeToSelect = args.time.format('h:mma')

	const isTimeSelected = await page.evaluate((timeToSelect: string) => {
		const dataComp = document.querySelector('[data-component="spotpicker-times-list"]')
		if (!dataComp) { return false }
		const timeElements = Array.from(dataComp.querySelectorAll('[role="listitem"]'))
		const timeToSelectListItem = timeElements.find(element => element.textContent?.trim() === timeToSelect)

		if (timeToSelectListItem) {
			timeToSelectListItem.scrollIntoView({ behavior: 'smooth', block: 'start' })

			const timeButton = timeToSelectListItem.querySelector('button')
			if (timeButton) {
				timeButton.click()
			}

			const nextButton = timeToSelectListItem.querySelector('button:not([data-container="time-button"])')
			if (!nextButton) { return false }
			(nextButton as any).click()
			return true
		}
		return false
	}, timeToSelect)

	if (isTimeSelected === false) {
		throw new Error('Time not available')
	}

	await page.evaluate(() => {
		const bookingContainer = document.querySelector('[data-container="booking-container"]')
		bookingContainer?.scrollIntoView({ behavior: 'smooth', block: 'end' })
	})

	logger.debug('Time selected')
	await new Promise((resolve) => setTimeout(resolve, 3000))

	await page.type('input[id="full_name_input"]', args.name)
	await page.type('input[id="email_input"]', args.email)

	await page.type('textarea[type="textarea"]', args.details ? args.details : ' ')
		.catch(() => logger.debug('Calendly page: no details field found'))

	await page.type('input[type="tel"]', args.phone)
		.catch(() => logger.debug('Calendly page: no phone field found'))

	await page.click('[type="submit"]')

	const confirmationHeaderSelector = 'div[data-component="confirmation-header"]'
	await page.waitForSelector(confirmationHeaderSelector)

	const headerElement = await page.$(confirmationHeaderSelector)
	if (headerElement) {
		const headerText = await page.evaluate(element => element.textContent?.trim(), headerElement)
		if (headerText?.includes('You are scheduled')) {
			logger.debug('Scheduled, confirmation text found')
		} else {
			logger.debug('Not Scheduled: Confirmation text not found')
		}
	} else {
		logger.debug('Not Scheduled: Confirmation header element not found')
	}
}

export const getClosestAvailableTimeToDate = async (args: GetAvailableTimesArgs, targetTime: moment.Moment): Promise<moment.Moment> => {
	const availableTimes = await getAvailableTimes(args)
	const targetDate = targetTime.format('YYYY-MM-DD')
	const availableTimesForDate = availableTimes.find(availableTime => availableTime.date === targetDate)

	if (!availableTimesForDate) {
		throw new Error('No available times for date')
	}

	let nearestTime: moment.Moment | null = null

	logger.debug('Finding nearest time...')
	for (const time of availableTimesForDate.times) {
		const availableTime = moment(time)
		const diff = Math.abs(availableTime.diff(targetTime))
		logger.debug(`Time: ${time}, diff: ${diff}`)

		if (!nearestTime || diff < Math.abs(nearestTime.diff(targetTime))) {
			logger.debug(`New nearest time found: ${time}`)
			nearestTime = availableTime
		}
	}

	logger.debug(`Nearest time found: ${nearestTime}`)

	if (nearestTime) {
		return nearestTime
	} else {
		throw new Error('No nearest time found')
	}
}

export const formatCalendlyPrompt = (availableTimes: CalendlyAvailableTime[], timezone: string): string => {
	let prompt = '**Calendly Available Times**\n'
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
