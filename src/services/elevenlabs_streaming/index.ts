import { URL, URLSearchParams } from 'url'
import { WebSocket } from 'ws'
import logger from '../../util/logger.util'

// Interface for the response from ElevenLabs
export interface ElevenLabsResponse {
	audio?: string
	isFinal?: boolean
	alignment?: {
		chars_start_times_ms: number[]
		chars_durations_ms: number[]
		chars: string[]
	}
	normalizedAlignment?: {
		chars_start_times_ms: number[]
		chars_durations_ms: number[]
		chars: string[]
	}
	message?: string
}

// Interface for the options to create ElevenLabsStream instance
export interface ElevenLabsStreamOptions {
	model: string
	voiceId: string
	output_format: string
	isVerbose?: boolean
}

export class ElevenLabsStream {

	private readonly voiceId: string
	private readonly model: string
	private readonly output_format: string
	private readonly completeUrl: string
	private readonly api_key: string = process.env.ELEVENLABS_API_KEY || ''
	private socket: WebSocket | null = null
	private reconnectAttempts: number = 0
	private reconnecting: boolean = false
	private inputQueue: string[] = []
	private connecting: boolean = false
	private closeRequest: boolean = false
	private isVerbose: boolean = false
	private createTime: number = 0
	private connectTime: number = 0
	private lastResponseTime: number = 0
	private lastSendTime: number = 0
	private totalReconnects: number = 0
	private totalTimeConnected: number = 0
	private messageHandler?: (message: ElevenLabsResponse) => Promise<void>

	/**
	 * Create a new ElevenLabsStream instance
	 * @param opts ElevenLabsStreamOptions
	 */
	constructor(opts: ElevenLabsStreamOptions) {
		this.voiceId = opts.voiceId
		this.model = opts.model
		this.output_format = opts.output_format
		this.isVerbose = opts.isVerbose || false

		const queryParams = {
			model_id: this.model,
			output_format: this.output_format,
			optimize_streaming_latency: '4',
			generation_config: JSON.stringify({
				chunk_length_schedule: [50, 75, 100, 125],
			}),
		}

		const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input`)
		url.search = new URLSearchParams(queryParams).toString()
		this.completeUrl = url.toString()
		this.createTime = performance.now()

		logger.info(
			`ElevenLabs: created new instance with voiceId: ${this.voiceId}` +
			`, model: ${this.model}` +
			`, output_format: ${this.output_format}` +
			`, url: ${this.completeUrl}`
		)
	}

	/**
	 * Handler for incoming messages from ElevenLabs
	 */
	public set onMessage(handler: (message: ElevenLabsResponse) => Promise<void>) {
		this.messageHandler = handler
	}

	/**
	 * Time since this instance was created
	 */
	public get createElapsed(): number {
		return performance.now() - this.createTime
	}

	/**
	 * Time since last connection was established with ElevenLabs
	 */
	public get connectElapsed(): number {
		return performance.now() - this.connectTime
	}

	/**
	 * Time since last message was sent to ElevenLabs
	 */
	public get sendElapsed(): number {
		return performance.now() - this.lastSendTime
	}

	/**
	 * Time since last response was received from ElevenLabs
	 */
	public get responseElapsed(): number {
		return performance.now() - this.lastResponseTime
	}

	/**
	 * Connect to ElevenLabs WebSocket
	 */
	private connect() {
		if (this.closeRequest || this.connecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
			return
		}

		this.connecting = true
		this.socket = new WebSocket(this.completeUrl)

		this.socket.onopen = async () => {
			this.reconnectAttempts = 0
			this.reconnecting = false
			this.connecting = false
			this.connectTime = performance.now()

			// Initialize the stream
			const streamInit = {
				xi_api_key: this.api_key,
				text: ' ',
			}
			try {
				this.socket?.send(JSON.stringify(streamInit))
				logger.info('ElevenLabs: WebSocket connection opened')
				this.processQueue()
			} catch (err) {
				logger.error('ElevenLabs: Error sending initial message:', err)
				this.connecting = false
				this.reconnect()
			}
		}

		this.socket.onmessage = async (event) => {
			if (this.isVerbose) {
				logger.debug(`ElevenLabs: received message: [${event.data}]`)
			}
			const rawData = event.data as string
			try {
				const parsedData: ElevenLabsResponse = JSON.parse(rawData)
				this.lastResponseTime = performance.now()
				if (this.messageHandler) {
					await this.messageHandler(parsedData)
				}
				if (parsedData.message) {
					logger.warn(`ElevenLabs: ${parsedData.message}`)
				}
			} catch (err) {
				logger.error('ElevenLabs: Error parsing or handling message:', err)
			}
		}

		this.socket.onclose = () => {
			const connectDuration = this.connectElapsed
			this.totalTimeConnected += connectDuration
			logger.info(
				'ElevenLabs: socket closed, ' +
				`${this.totalReconnects} total reconnects, ` +
				`${connectDuration.toFixed(2)}ms connect time, ` +
				`${this.totalTimeConnected.toFixed(2)}ms total time connected`
			)
			this.connecting = false
			this.reconnect()
		}

		this.socket.onerror = (error) => {
			logger.error('ElevenLabs: WebSocket error: ', error)
			this.connecting = false
			this.reconnect()
		}
	}

	/**
	 * Reconnect to ElevenLabs WebSocket with exponential backoff
	 */
	private reconnect() {
		if (this.closeRequest || this.reconnecting || this.reconnectAttempts >= 5) {
			return
		}
		this.reconnecting = true
		this.reconnectAttempts++

		// max backoff time of 30 seconds
		const backoffTime = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)
		logger.warn(`ElevenLabs: reconnecting in ${backoffTime}ms`)
		setTimeout(() => {
			if (this.closeRequest) {
				return
			}
			this.connect()
		}, backoffTime)
	}

	/**
	 * Process the message queue
	 */
	private processQueue() {
		logger.debug(`ElevenLabs: processing queue: ${this.inputQueue.length} messages`)
		while (
			!this.closeRequest &&
			this.inputQueue.length > 0 &&
			this.socket &&
			this.socket.readyState === WebSocket.OPEN) {
			const message = this.inputQueue.shift()
			if (message) {
				this.send(message)
			}
		}
	}

	/**
	 * Send a message to ElevenLabs
	 * @param message The message to send. Send an empty string
	 * to trigger audio generation.
	 */
	public send(message: string) {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			logger.debug(`ElevenLabs: socket not open, queueing message: [${message}]`)
			this.inputQueue.push(message)
			if (!this.connecting && !this.reconnecting) {
				this.connect()
			}
		} else {
			logger.debug(`ElevenLabs: sending message: [${message}]`)
			this.lastSendTime = performance.now()
			if (message.length === 0) {
				this.socket.send(JSON.stringify({
					text: '',
				}))
			} else {
				this.socket.send(JSON.stringify({
					text: message,
					try_trigger_generation: true,
				}))
			}
		}
	}

	/**
	 * Close the connection to ElevenLabs
	 */
	public close() {
		this.closeRequest = true
		if (this.socket) {
			this.socket.close()
			this.socket = null
		}
	}

}
