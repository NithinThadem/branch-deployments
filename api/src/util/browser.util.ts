import puppeteer from 'puppeteer'
import logger from './logger.util'

export const fetchTextFromWebsite = async (url: string) => {
	logger.debug(`Fetching HTML from ${url}`)

	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
		headless: 'new',
		defaultViewport: {
			width: 1080,
			height: 1024,
		},
	})

	logger.debug('Browser launched')

	const page = await browser.newPage()

	logger.debug('Page created')

	await Promise.all([
		page.goto(url),
		page.waitForNavigation(),
	])

	logger.debug('Page loaded')

	const urlOutput = await page.$eval('*', (el) => {
		const selection = window.getSelection()
		const range = document.createRange()
		range.selectNode(el)
		selection.removeAllRanges()
		selection.addRange(range)
		return window.getSelection().toString()
	})

	logger.debug('Extracted HTML')
	await browser.close()

	return urlOutput
}
