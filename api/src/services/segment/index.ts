import { Analytics as BaseAnalytics } from '@segment/analytics-node'
import logger from '../../util/logger.util'

class Analytics extends BaseAnalytics {

	constructor(writeKey: string) {
		super({
			writeKey,
			flushAt: 1,
		})
	}

	async event(eventName: string, properties: any) {
		try {
			super.track({
				event: eventName,
				userId: 'system',
				properties,
			})
			await super.flush()
		} catch (error) {
			logger.error('Analytics event failed:', error)
		}
	}

}

const analytics = new Analytics(process.env.SEGMENT_API_KEY)
export default analytics
