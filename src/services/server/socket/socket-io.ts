import { Server } from 'socket.io'
import {
	onCallSocket, onChatSocket, onTranscriptionSocket, onWidgetSocket,
} from '../../../modules/public/api/public.socket'
import logger from '../../../util/logger.util'
import { onOnboardingSocket } from '../../../modules/onboarding/api/onboarding.socket'
import { onJobSocket } from '../../../modules/job/api/job.socket'
import { onInterviewSocket, onInterviewTestSocket } from '../../../modules/interview/api/interview.socket'

const initSocketIo = (io: Server) => {
	// Public

	io.of('/public/transcribe').on('connection', (socket) => {
		logger.info(`[Socket] Connected (public/transcribe): ${socket.id}`)

		onTranscriptionSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (public/transcribe): ${socket.id}`)
		})
	})

	io.of('/public/call').on('connection', (socket) => {
		logger.info(`[Socket] Connected (public/call): ${socket.id}`)

		onCallSocket(socket)

		socket.on('ping', (cb) => {
			if (typeof cb === 'function') { cb() }
		})

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (public/call): ${socket.id}`)
		})
	})

	io.of('/public/chat').on('connection', (socket) => {
		logger.info(`[Socket] Connected (public/chat): ${socket.id}`)

		onChatSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (public/chat): ${socket.id}`)
		})
	})

	io.of('/public/widget').on('connection', (socket) => {
		logger.info(`[Socket] Connected (public/widget): ${socket.id}`)

		onWidgetSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (public/widget): ${socket.id}`)
		})
	})

	// Onboarding

	io.of('/onboarding').on('connection', (socket) => {
		logger.info(`[Socket] Connected (onboarding): ${socket.id}`)

		onOnboardingSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (onboarding): ${socket.id}`)
		})
	})

	// Job

	io.of('/job').on('connection', (socket) => {
		logger.info(`[Socket] Connected (job): ${socket.id}`)

		onJobSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (job): ${socket.id}`)
		})
	})

	// Interview

	io.of('/interview').on('connection', (socket) => {
		logger.info(`[Socket] Connected (interview): ${socket.id}`)

		onInterviewSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (interview): ${socket.id}`)
		})
	})

	io.of('/interview/test').on('connection', (socket) => {
		logger.info(`[Socket] Connected (interview/test): ${socket.id}`)

		onInterviewTestSocket(socket)

		socket.on('disconnect', () => {
			logger.debug(`[Socket] Disconnected (interview/test): ${socket.id}`)
		})
	})
}

export default initSocketIo
