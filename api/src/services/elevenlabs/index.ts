import * as WebSocket from 'ws'
import axios from 'axios'
import { withExponentialBackoff } from '../../util/helpers.util'
import logger from '../../util/logger.util'

const synthesizeSpeech = async ({
	id,
	text,
	outputFormat = 'mp3_44100',
}: {
	id: string
	text: string
	outputFormat?: string
}) => {
	const url = `https://api.elevenlabs.io/v1/text-to-speech/${id}`

	const response = await withExponentialBackoff(async () =>
		await axios.post(url, {
			text,
			model_id: 'eleven_multilingual_v2',
		}, {
			headers: {
				Accept: 'audio/mpeg',
				'Content-Type': 'application/json',
				'xi-api-key': process.env.ELEVENLABS_API_KEY,
			},
			params: {
				output_format: outputFormat,
				optimize_streaming_latency: '0',
			},
			responseType: 'arraybuffer',
		})
	)

	return response.data
}

const getVoices = async () => {
	const url = 'https://api.elevenlabs.io/v1/voices'

	const response = await axios.get(url, {
		headers: {
			'xi-api-key': process.env.ELEVENLABS_API_KEY,
		},
	})

	return response.data
}

const getModels = async () => {
	const url = 'https://api.elevenlabs.io/v1/models'

	const response = await axios.get(url, {
		headers: {
			'xi-api-key': process.env.ELEVENLABS_API_KEY,
		},
	})

	return response.data
}

const getElevenLabsWebSocket = ({
	voiceId,
	model = 'eleven_monolingual_v1',
	outputFormat = 'mp3_44100',
	onOpen,
	onMessage,
	onClose,
	onError,
	maxRetries = 3,
	retryDelay = 100,
	retries = 0,
}: {
	voiceId: string
	model?: string
	outputFormat?: string
	onOpen?: () => void
	onMessage?: (event: MessageEvent) => void
	onClose?: () => void
	onError?: (event: ErrorEvent) => void
	maxRetries?: number
	retryDelay?: number
	retries?: number
}): WebSocket => {
	const queryParams = {
		model_id: model,
		output_format: outputFormat,
		optimize_streaming_latency: '4',
		generation_config: JSON.stringify({
			chunk_length_schedule: [50, 75, 100, 125],
		}),
	}

	const queryString = Object.keys(queryParams)
		.map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
		.join('&')

	const socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?${queryString}`)
	let isConnected
	const queue: string[] = []

	const connect = () => {
		socket.onopen = () => {
			const bosMessage = {
				text: ' ',
				// voice_settings: {
				// 	stability: 0.5,
				// 	similarity_boost: true,
				// },
				xi_api_key: process.env.ELEVENLABS_API_KEY,
			}

			socket.send(JSON.stringify(bosMessage))

			if (onOpen) {
				onOpen()
			}

			isConnected = true

			if (queue.length) {
				queue.forEach((message) => {
					socket.send(message)
				})
			}
		}

		socket.onmessage = onMessage as any
		socket.onclose = onClose as any
		socket.onerror = (event: any) => {
			isConnected = false
			logger.error(`Received error from ElevenLabs WebSocket: ${event}`)
			if (retries < maxRetries) {
				retries++
				logger.info(`Retrying connection to ElevenLabs WebSocket in ${retryDelay}ms for the ${retries} time`)
				setTimeout(connect, retryDelay)
			} else {
				logger.error('Max retries reached for ElevenLabs WebSocket. Closing connection.')
				if (onError) {onError(event as ErrorEvent)}
			}
		}

		socket.send = (message: string) => {
			if (isConnected) {
				WebSocket.prototype.send.call(socket, message)
			} else {
				queue.push(message)
			}
		}
	}

	connect()
	return socket
}

const ElevenLabs = {
	synthesizeSpeech,
	getElevenLabsWebSocket,
	getVoices,
	getModels,
}

export default ElevenLabs
