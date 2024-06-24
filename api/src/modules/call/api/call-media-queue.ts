import { EventEmitter } from 'events'
import { WebSocket } from 'ws'
import { MuLawAudioUtil } from './mulaw-audio-util'
import { MuLawAudioMixer } from './mulaw-audio-mixer'
import { AudioFileReader } from './audio-file-reader'
import { AudioFileCatalog } from './audio-file-catalog'
import { SafeQueue } from './safe-queue'
import logger from '../../../util/logger.util'

interface SocketMessage {
	event: 'media' | 'mark' | 'clear';
	media?: {
		payload: string
	}
	mark?: {
		name: string
	}
}

interface CallMediaQueueArgs {
	streamSid: string;
	socket: WebSocket;
	backgroundTrackName?: string;
	interimTrackName?: string;
	backgroundVolume?: number;
	voiceVolume?: number;
}

class CallMediaQueue extends EventEmitter {

	private readonly simulateRealTimeAudio: boolean = true

	// Send audio to twilio at the rate it comes in, 20ms per packet
	private readonly mediaRateMs: number = 20
	private readonly mediaRateBytes: number = MuLawAudioUtil.getAudioBufferBytes(this.mediaRateMs / 1000)

	private isProcessing: boolean = false
	private queue: SafeQueue<SocketMessage>
	private streamSid: string
	private socket: WebSocket
	private interimReader: AudioFileReader | null
	private backgroundReader: AudioFileReader | null
	private backgroundEnabled: boolean
	private backgroundTimerId: NodeJS.Timeout | null
	private voiceVolume = 1
	private backgroundVolume = 1
	private interimCountdown = 0

	static {
		try {
			AudioFileCatalog.initialize()
		} catch (err) {
			logger.error('Error', err)
		}
	}

	constructor(args: CallMediaQueueArgs) {
		super()
		this.queue = new SafeQueue<SocketMessage>()
		this.streamSid = args.streamSid
		this.socket = args.socket
		this.backgroundTimerId = null
		this.backgroundEnabled = false
		this.backgroundReader = null
		this.interimReader = null

		if (args.interimTrackName && AudioFileCatalog.has(args.interimTrackName)) {
			this.interimReader = new AudioFileReader(args.interimTrackName)
			this.backgroundEnabled = true
		}

		if (args.backgroundTrackName && AudioFileCatalog.has(args.backgroundTrackName)) {
			this.backgroundReader = new AudioFileReader(args.backgroundTrackName)
			this.backgroundVolume = AudioFileCatalog.getVolume(args.backgroundTrackName)
			this.backgroundEnabled = true
		}

		if (args.backgroundVolume) {
			this.backgroundVolume = Math.max(0, Math.min(1, args.backgroundVolume))
		}

		if (args.voiceVolume) {
			this.voiceVolume = Math.max(0, Math.min(1, args.voiceVolume))
		}

		this.socket.on('message', async (message) => {
			const data = JSON.parse(message.toString())

			switch (data.event) {
				case 'mark': {
					this.emit('mark', data.mark.name)
					break
				}
			}
		})

		logger.info(
			'CallMediaQueue created for stream SID: ' + this.streamSid +
			', Simulate real-time audio: ' + this.simulateRealTimeAudio +
			', Media rate: ' + this.mediaRateMs + 'ms' +
			', Media rate bytes: ' + this.mediaRateBytes +
			', Background audio enabled: ' + this.backgroundEnabled +
			', Background track: ' + (this.backgroundReader?.Name ?? 'None') +
			', Background volume: ' + this.backgroundVolume +
			', Interim track: ' + (this.interimReader?.Name ?? 'None') +
			', Voice volume: ' + this.voiceVolume
		)

		this.startBackgroundAudio(this.mediaRateMs)
	}

	private startBackgroundAudio(milliseconds: number): void {
		this.backgroundTimerId = setInterval(async () => {
			if (!this.backgroundEnabled || await this.queue.length() > 0) { return }
			await this.enqueueBackgroundAudioChunk(milliseconds)
		}, milliseconds)
	}

	public stopBackgroundAudio(): void {
		this.backgroundEnabled = false
		clearInterval(this.backgroundTimerId)
		this.backgroundTimerId = null
	}

	private mixBackgroundAndInterimAudio(interval: number): Buffer {
		const durationSeconds = interval / 1000
		const bytesNeeded = MuLawAudioUtil.getAudioBufferBytes(durationSeconds)

		let chunk: Buffer = null

		// First, read the background audio track
		if (this.backgroundReader !== null) {
			chunk = this.backgroundReader.read(bytesNeeded)
			chunk = MuLawAudioMixer.volume(chunk, this.backgroundVolume)
		}

		// Then, mix in the interim audio track if it is enabled
		if (this.interimReader !== null && this.interimCountdown > 0) {
			if (chunk !== null) {
				const interimChunk = this.interimReader.read(bytesNeeded)
				chunk = MuLawAudioMixer.mix(chunk, interimChunk)
			} else {
				chunk = this.interimReader.read(bytesNeeded)
			}

			this.interimCountdown -= interval
			this.interimCountdown = Math.max(0, this.interimCountdown)

			if (this.interimCountdown === 0) {
				logger.info('*** Interim audio playback complete')
			}
		}

		return chunk
	}

	private async enqueueBackgroundAudioChunk(interval: number): Promise<void> {
		const chunk = this.mixBackgroundAndInterimAudio(interval)

		if (chunk === null) {
			return
		}

		await this.queue.enqueue({
			event: 'media',
			media: {
				payload: chunk.toString('base64'),
			},
		})

		this.processNext()
	}

	private async processNext(): Promise<void> {
		if (this.isProcessing) {
			return
		}

		this.isProcessing = true

		let socketMessage: SocketMessage | undefined
		try {
			socketMessage = await this.queue.dequeue()
			while (socketMessage !== undefined) {
				this.sendToTwilio(socketMessage)
				if (this.simulateRealTimeAudio && socketMessage.event === 'media' && socketMessage.media) {
					const delay = MuLawAudioUtil.getAudioBufferDurationFromString(socketMessage.media.payload) * 1000
					await new Promise(resolve => setTimeout(resolve, delay))
				}
				socketMessage = await this.queue.dequeue()
			}
		} catch (err) {
			logger.error('CallMediaQueue.processNext', err)
		} finally {
			this.isProcessing = false
		}
	}

	private mixAgentAndBackgroundAudio(payload: string): Buffer {
		const voiceBuffer = Buffer.from(payload, 'base64')

		if (this.backgroundReader !== null) {
			const bgBuffer = this.backgroundReader.read(voiceBuffer.length)
			const mixedBuffer = MuLawAudioMixer.mixWithVolume(
				voiceBuffer, bgBuffer,
				this.voiceVolume, this.backgroundVolume
			)
			return mixedBuffer
		}

		return voiceBuffer
	}

	private sendToTwilio(socketMessage: SocketMessage) {
		this.socket.send(
			JSON.stringify({
				event: socketMessage.event,
				streamSid: this.streamSid,
				media: socketMessage.media,
				mark: socketMessage.mark,
			}),
		)
	}

	private async clearQueue(): Promise<void> {
		await this.queue.clear()
		this.interimCountdown = 0
	}

	/**
	 * Create an array of SocketMessage objects from a buffer.
	 * Each SocketMessage will contain a chunk of the buffer.
	 * @param buffer Audio buffer to divide
	 * @param chunkSize Size of each chunk
	 * @returns Array of SocketMessage objects
	 */
	private createSocketMessagesFromBuffer(buffer: Buffer, chunkSize: number): SocketMessage[] {
		const chunks = this.divideBuffer(buffer, chunkSize)
		const socketMessages: SocketMessage[] = chunks.map((chunk) => ({
			event: 'media',
			media: {
				payload: chunk.toString('base64'),
			},
		}))
		return socketMessages
	}

	/**
	 * Divide a buffer into chunks of a given size.
	 * If the last chunk is less than the chunk size,
	 * it will be merged with the previous chunk.
	 * @param buffer Audio buffer to divide
	 * @param chunkSize Size of each chunk
	 * @returns Array of buffers
	 */
	private divideBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
		const kBufferlength = buffer.length
		const chunks: Buffer[] = []
		let start = 0

		while (start < kBufferlength) {
			let end = start + chunkSize
			if (end > kBufferlength) {
				end = kBufferlength
			}
			chunks.push(buffer.subarray(start, end))
			start = end
		}

		// adjust the final chunk if it's less than chunkSize
		if (chunks.length > 1 && chunks[chunks.length - 1].length < chunkSize) {
			const lastChunk = chunks.pop()
			const secondLastChunk = chunks.pop()
			const newLastChunk = Buffer.concat([secondLastChunk, lastChunk])
			chunks.push(newLastChunk)
		}

		return chunks
	}

	private async internalMedia(payload: string): Promise<void> {
		this.stopInterimAudio()

		const mixedBuffer = this.mixAgentAndBackgroundAudio(payload)

		// If the buffer is less than 2x the media rate, send it as a single packet
		if (mixedBuffer.length < this.mediaRateBytes * 2) {
			await this.queue.enqueue({
				event: 'media',
				media: {
					payload: mixedBuffer.toString('base64'),
				},
			})
		} else {
			// Otherwise, divide the buffer into chunks and send each chunk as a separate packet
			await this.queue.enqueue(
				this.createSocketMessagesFromBuffer(
					mixedBuffer,
					this.mediaRateBytes
				)
			)
		}

		this.processNext()
	}

	private async internalMark(name: string): Promise<void> {
		await this.queue.enqueue({
			event: 'mark',
			mark: {
				name,
			},
		})
	}

	private async internalClear(): Promise<void> {
		this.sendToTwilio({ event: 'clear' })
		await this.clearQueue()
	}

	playInterimAudio(seconds: number = 10): void {
		if (this.interimReader === null) {
			logger.debug('Interim audio is not enabled')
			return
		}

		if (this.interimCountdown > 0) {
			logger.debug('Interim audio is already playing')
			return
		}

		// keep seconds between 0 and 30
		seconds = Math.min(30, Math.max(0, seconds))

		this.interimCountdown = seconds * 1000
		logger.info(`Play interim audio for ${this.interimCountdown} milliseconds`)
	}

	stopInterimAudio(): void {
		if (this.interimCountdown > 0) {
			this.interimCountdown = 0
			logger.info('Stopped interim audio')
		}
	}

	media(payload: string): void {
		this.internalMedia(payload).catch((err) => logger.error('Error', err))
	}

	mark(name: string): void {
		this.internalMark(name).catch((err) => logger.error('Error', err))
	}

	clear(): void {
		this.internalClear().catch((err) => logger.error('Error', err))
	}

}

export default CallMediaQueue
