import { handleEvent } from '.'
import logger from '../../util/logger.util'
import { publishEvent } from '../google/pubsub'
import { EventMap } from './event.map'
import { EventEmitter } from 'stream'

export interface TypedEmitter<Events extends EventMap> {
	addListener<E extends keyof Events>(event: E, listener: Events[E]): this
	on<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this
	once<E extends keyof Events>(event: E, listener: Events[E]): this
	prependListener<E extends keyof Events>(event: E, listener: Events[E]): this
	prependOnceListener<E extends keyof Events>(event: E, listener: Events[E]): this
	off<E extends keyof Events>(event: E, listener: Events[E]): this
	removeAllListeners<E extends keyof Events>(event?: E): this
	removeListener<E extends keyof Events>(event: E, listener: Events[E]): this
	emit<E extends keyof Events>(event: E, args: Events[E]): boolean
	eventNames(): (keyof Events | string | symbol)[]
	rawListeners<E extends keyof Events>(event: E): Events[E][]
	listeners<E extends keyof Events>(event: E): Events[E][]
	listenerCount<E extends keyof Events>(event: E): number
	getMaxListeners(): number
	setMaxListeners(maxListeners: number): this
}

export class EventUtil extends (EventEmitter as new () => TypedEmitter<EventMap>) {

	async asyncEmit<E extends keyof EventMap>(eventName: E, args?: EventMap[E], testOverride: boolean = false) {
		if (process.env.PROCESSOR === 'true') {
			logger.debug(`[Event] Emitting ${eventName} as processor: ${JSON.stringify(args)}`)
			return handleEvent(eventName, args)
		}
		logger.debug(`[Event] Emitting ${eventName} (${process.env.NODE_ENV}): ${JSON.stringify(args)}`)
		switch (process.env.NODE_ENV) {
			case 'testing': {
				if (testOverride) {
					logger.debug(`[Test Event] Emitting ${eventName}: ${JSON.stringify(args)}`)
					return super.emit(eventName, args)
				} else {
					logger.debug(`Skipping event publishing in testing environment for ${eventName}`)
					return
				}
			}
			case 'development': {
				return super.emit(eventName, args)
			}
			default: { // staging, production
				return publishEvent({ eventName, args })
			}
		}
	}

}
