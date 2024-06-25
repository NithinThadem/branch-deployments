/* eslint-disable max-len */
import * as child_process from 'child_process'
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { getCacheDirectory } from '../../util/helpers.util'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import logger from '../../util/logger.util'

let isNvidiaGPUAvailableCache: boolean | null = null

function isNvidiaGPUAvailable() {
	return new Promise<boolean>((resolve) => {
		if (isNvidiaGPUAvailableCache !== null) {
			resolve(isNvidiaGPUAvailableCache)
		} else {
			const ffmpegProcess = child_process.spawn('ffmpeg', ['-hwaccels'])

			let stdoutData = ''

			ffmpegProcess.stdout.on('data', (data) => {
				stdoutData += data.toString()
			})

			ffmpegProcess.on('close', (code) => {
				if (code === 0) {
					isNvidiaGPUAvailableCache = stdoutData.includes('cuda')

					if (isNvidiaGPUAvailableCache) {
						logger.debug('Nvidia GPU acceleration is available.')
					} else {
						logger.debug('Nvidia GPU acceleration is not available.')
					}

					resolve(isNvidiaGPUAvailableCache)
				} else {
					resolve(false)
				}
			})

			ffmpegProcess.on('error', () => resolve(false))
		}
	})
}

const spawnProcess = (
	command: string[],
): Promise<void> => new Promise<void>((resolve, reject) => {
	isNvidiaGPUAvailable().then((isAvailable) => {
		if (isAvailable) {
			command.unshift('-hwaccel', 'cuda') // Use Nvidia GPU for decoding
		}

		const ffmpegPath = isAvailable ? 'ffmpeg' : ffmpegInstaller.path

		const ffmpegProcess = child_process.spawn(ffmpegPath, command)
		let stderrData = '' // Buffer to store FFMPEG error messages

		ffmpegProcess.stdout.on('data', (data) => {
			logger.debug(`[FFmpeg] ${data}`)
		})

		ffmpegProcess.stderr.on('data', (data) => {
			const errorMessage = data.toString()
			stderrData += errorMessage // Append error message to buffer
			logger.debug(`[FFmpeg] ${data}`)
		})

		ffmpegProcess.on('close', (code) => {
			logger.debug(`[FFmpeg] child process exited with code ${code}`)
		})

		ffmpegProcess.on('error', (err) => {
			reject(new Error(`FFmpeg process failed: ${err.message}`))
		})

		ffmpegProcess.on('exit', (code, signal) => {
			if (code === 0) {
				resolve()
			} else {
				const errorMessage = `FFmpeg process exited with code ${code}:\n${stderrData}`
				reject(new Error(errorMessage))
			}
		})
	})
})

export const streamMp3ToMulaw = () => child_process.spawn(ffmpegInstaller.path, [
	'-i', 'pipe:0', // Input from stdin
	'-f', 'mp3', // Input format (MP3)
	'-ar', '8000', // Desired sample rate (8000 Hz)
	'-ac', '1', // Mono audio
	'-f', 'mulaw', // Output format (μ-law)
	'pipe:1', // Output to stdout
])

export const splitAudioFromVideo = async (
	inputFilePath: string,
	outputFilePath: string,
	encode?: boolean
): Promise<void> => {
	const command = [
		'-i', inputFilePath,
		'-vn', // Extract audio only
	]

	if (encode) {
		command.push(
			'-c:a', 'pcm_s16le',
			'-ar', '48000',
		)
	} else {
		command.push('-acodec', 'copy')
	}

	return spawnProcess([
		...command,
		'-y',
		outputFilePath,
	])
}

export const convertWebmToMp4 = async (
	inputFilePath: string,
	outputFilePath: string
): Promise<void> => {
	const command = [
		'-i', inputFilePath,
		'-c:v', 'libx264',
		'-c:a', 'aac',
		'-strict', 'experimental',
		'-q:v', '0',
		'-q:a', '0',
		'-y',
		outputFilePath,
	]

	return spawnProcess(command)
}

export const mergeAndConvertToMP4 = async (
	inputFilePaths: string[],
	outputFilePath: string
): Promise<string> => {
	const cacheDirectory = getCacheDirectory()
	const inputFilePathsFile = join(cacheDirectory, `input-${Date.now()}.txt`)

	await writeFile(inputFilePathsFile, inputFilePaths.map((inputFilePath) => `file '${inputFilePath}'`).join('\n'), 'utf-8')

	const args = [
		'-f', 'concat',
		'-safe', '0',
		'-i', inputFilePathsFile,
		'-r', '30', // Output framerate
		'-preset', 'fast', // Encoding speed (fast, medium, slow, etc)
		'-b:v', '5M', // Video bitrate (adjust as needed)
		'-c:a', 'aac', // Audio codec: AAC
		'-strict', 'experimental',
	]

	if (await isNvidiaGPUAvailable()) {
		args.push('-c:v', 'h264_nvenc')
	} else {
		args.push('-c:v', 'libx264')
	}

	await spawnProcess([
		...args,
		'-y',
		outputFilePath,
	])

	return inputFilePathsFile
}

export const addWatermarkToVideo = async (
	videoFilePath: string,
	imageFilePath: string,
	outputFilePath: string
): Promise<void> => {
	const videoInfo = await getVideoInfo(videoFilePath)
	const videoWidth = videoInfo.width
	const videoHeight = videoInfo.height

	// Calculate the desired width and height of the watermark
	const watermarkWidth = Math.round(videoWidth * 0.3)
	const watermarkHeight = Math.round(watermarkWidth * (videoInfo.aspectRatio || 1))

	// Ensure the height is divisible by 2
	const adjustedWatermarkHeight = watermarkHeight % 2 === 0 ? watermarkHeight : watermarkHeight - 1

	// Calculate watermark position based on video dimensions (center bottom)
	const posX = (videoWidth - watermarkWidth) / 2
	const posY = videoHeight - adjustedWatermarkHeight - 10

	// eslint-disable-next-line max-len
	const filter = `[0:v]scale=-2:${adjustedWatermarkHeight}[scaled];[scaled][1:v] overlay=${posX}:${posY}:enable='between(t,0,${videoInfo.duration})'`

	return spawnProcess([
		'-i', videoFilePath,
		'-i', imageFilePath,
		'-filter_complex', filter,
		'-c:a', 'copy',
		'-y',
		outputFilePath,
	])
}

type VideoInfo = {
	width: number
	height: number
	aspectRatio: number | null
	duration: number
	rotation: number

}

export const getVideoInfo = (videoFilePath: string): Promise<VideoInfo> => new Promise<VideoInfo>((resolve, reject) => {
	const ffprobeCommand = [
		'-v', 'error',
		'-show_entries', 'stream=width,height,display_aspect_ratio,duration,tags',
		'-sexagesimal',
		'-print_format', 'json',
		videoFilePath,
	]

	const ffprobeProcess = child_process.spawn(ffprobeInstaller.path, ffprobeCommand)

	let output = ''

	ffprobeProcess.stdout.on('data', (data) => {
		output += data.toString()
	})

	ffprobeProcess.stderr.on('data', (data) => {
		output += data.toString()
	})

	ffprobeProcess.on('close', (code) => {
		if (code === 0) {
			try {
				const info = JSON.parse(output)

				logger.debug(`[FFprobe] ${JSON.stringify(info, null, 2)}`)

				const videoStream = info.streams.find((stream: any) => stream.width && stream.height)
				if (videoStream) {
					const width = parseInt(videoStream.width)
					const height = parseInt(videoStream.height)
					const aspectRatio = parseAspectRatio(videoStream.display_aspect_ratio)
					const duration = parseDuration(videoStream.duration)

					// Extract rotation if available
					const rotation = videoStream.tags && videoStream.tags.rotate ? parseInt(videoStream.tags.rotate) : 0

					resolve({ width, height, aspectRatio, duration, rotation })
				} else {
					reject(new Error('Video stream not found in FFprobe output.'))
				}
			} catch (error) {
				reject(`Failed to parse FFprobe output: ${error}`)
			}
		} else {
			reject(new Error('Failed to get video info using FFprobe.'))
		}
	})
})

function parseAspectRatio(aspectRatioString: string | undefined): number | null {
	if (aspectRatioString) {
		const [width, height] = aspectRatioString.split(':').map((val) => parseInt(val))
		if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
			return width / height
		}
	}
	return null
}

function parseDuration(durationString: string): number {
	if (parseDuration) {
		const timeComponents = durationString.split(':').map((val) => parseFloat(val))
		if (timeComponents.length === 3) {
			const hours = timeComponents[0]
			const minutes = timeComponents[1]
			const seconds = timeComponents[2]
			return hours * 3600 + minutes * 60 + seconds
		} else if (timeComponents.length === 2) {
			const minutes = timeComponents[0]
			const seconds = timeComponents[1]
			return minutes * 60 + seconds
		} else if (timeComponents.length === 1) {
			return timeComponents[0]
		} else {
			return 0
		}
	}
	return 0
}

export const splitVideoBySeconds = async (
	inputFilePath: string,
	outputFilePath: string,
	startTimeSeconds: number,
	endTimeSeconds: number
): Promise<void> => spawnProcess([
	'-i', inputFilePath,
	'-ss', startTimeSeconds.toString(),
	'-to', endTimeSeconds.toString(),
	'-c', 'copy',
	'-avoid_negative_ts', 'make_zero',
	'-y',
	outputFilePath,
])

export const generateThumbnail = async (
	inputFilePath: string,
	outputFilePath: string,
	timestampSeconds: number = 5
): Promise<void> => {
	const command = [
		'-i', inputFilePath,
		'-ss', timestampSeconds.toString(),
		'-vframes', '1',
		'-q:v', '2',
		'-y',
		outputFilePath,
	]

	return spawnProcess(command)
}

export const cropVideoToAspectRatio = async (
	inputFilePath: string,
	outputFilePath: string,
	aspectRatio: string = '9:16'
): Promise<void> => {
	// Get original video dimensions and other details.
	const videoInfo = await getVideoInfo(inputFilePath)

	// Split the desired aspect ratio string (e.g., '9:16') into its width and height ratios.
	const [targetWidthRatio, targetHeightRatio] = aspectRatio.split(':').map(Number)

	let targetWidth: number
	let targetHeight: number

	targetHeight = videoInfo.width * targetHeightRatio / targetWidthRatio

	// If targetHeight is more than the video's original height, compute width instead
	if (targetHeight > videoInfo.height) {
		targetWidth = videoInfo.height * targetWidthRatio / targetHeightRatio
		targetHeight = videoInfo.height
	} else {
		targetWidth = videoInfo.width
	}

	const xOffset: number = (videoInfo.width - targetWidth) / 2
	const yOffset: number = (videoInfo.height - targetHeight) / 2

	// Construct the ffmpeg filter for cropping
	const cropFilter = `crop=${Math.round(targetWidth)}:${Math.round(targetHeight)}:${Math.round(xOffset)}:${Math.round(yOffset)}`

	const args = [
		'-i', inputFilePath,
		'-vf', cropFilter,
	]

	if (await isNvidiaGPUAvailable()) {
		args.push('-c:v', 'h264_nvenc') // Use Nvidia GPU for encoding (h264_nvenc for H.264)
		args.push('-c:a', 'aac') // Audio codec: AAC
		args.push('-preset', 'fast') // Encoding speed (fast, medium, slow, etc)
	} else {
		args.push('-c:a', 'copy') // Audio codec: AAC
	}

	return spawnProcess([
		...args,
		'-y',
		outputFilePath,
	])
}
