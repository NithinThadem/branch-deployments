import { promises as fs } from 'fs'
import * as path from 'path'
import { AudioFileReader } from './audio-file-reader'
import { MuLawAudioUtil } from './mulaw-audio-util'
import logger from '../../../util/logger.util'
import { isDevelopment } from '../../../util/env.util'

interface AudioFileItem {
	data: Buffer
	volume: number
}

export class AudioFileCatalog {

	private static readonly kSilenceTrackName = 'silence'
	private static readonly kBytesPerMegabyte = 1024 * 1024
	private static readonly kMaxFileSizeBytes = 10 * AudioFileCatalog.kBytesPerMegabyte
	private static readonly catalog: Map<string, AudioFileItem> = new Map()
	private static totalBytesLoaded: number = 0

	public static get isEmpty(): boolean {
		return AudioFileCatalog.catalog.size === 0
	}

	/**
	 * Gets the names of all audio files in the catalog.
	 */
	public static get getNames(): string[] {
		return Array.from(AudioFileCatalog.catalog.keys())
	}

	/**
	 * Checks if the audio file catalog has a given audio file.
	 * @param name Name of the audio file
	 * @returns Whether the audio file exists in the catalog
	 */
	public static has(name: string): boolean {
		return AudioFileCatalog.catalog.size > 0 && AudioFileCatalog.catalog.has(name)
	}

	public static getVolume(name: string): number {
		return AudioFileCatalog.catalog.get(name).volume
	}

	private static setVolume(name: string, volume: number): void {
		const item = AudioFileCatalog.catalog.get(name)
		if (item) {
			item.volume = Math.max(0, Math.min(1, volume))
		}
	}

	public static getRandomTrackPosition(name: string): number {
		const item = AudioFileCatalog.catalog.get(name)
		if (!item) {
			throw new Error(`Audio file not found: ${name}`)
		}

		const data = item.data
		const kTwoSecondInBytes = MuLawAudioUtil.kBytesPerSecond * 2

		if (data.length <= kTwoSecondInBytes) {
			return 0
		}

		return Math.floor(Math.random() * (data.length - kTwoSecondInBytes))
	}

	/**
	 * Selects a random audio file from the catalog.
	 * @param excludeSilenceTrack Whether to exclude the built-in silence track
	 * @returns Name of the selected audio file
	 */
	public static selectRandom(excludeSilenceTrack: boolean = true): string {
		const keys = Array.from(AudioFileCatalog.catalog.keys())
		if (excludeSilenceTrack) {
			const index = keys.indexOf(AudioFileCatalog.kSilenceTrackName)
			if (index > -1) {
				keys.splice(index, 1)
			}
		}

		const randomIndex = Math.floor(Math.random() * keys.length)
		return keys[randomIndex]
	}

	/**
	 * Reads audio data from the catalog, with a given reader and number of bytes.
	 * @param reader Your instance to a reader
	 * @param bytes How many bytes to read, with wrap around
	 * @returns Buffer with audio data
	 */
	public static read(reader: AudioFileReader, bytes: number): Buffer {
		const item = AudioFileCatalog.catalog.get(reader.Name)
		if (!item) {
			throw new Error(`Audio file not found: ${reader.Name}`)
		}

		const data = item.data
		const length = data.length
		const buffer = Buffer.alloc(bytes)

		for (let i = 0; i < bytes; i++) {
			buffer[i] = data[reader.position]
			reader.position = (reader.position + 1) % length
		}

		return buffer
	}

	// Static initialization
	static async initialize(): Promise<void> {
		AudioFileCatalog.addSilenceTrack()
		await AudioFileCatalog.loadAudioFiles('./assets/audio')
		AudioFileCatalog.assignVolumePresets()
	}

	private static addSilenceTrack(): void {
		const silence = MuLawAudioUtil.createSilenceBuffer(10)
		AudioFileCatalog.catalog.set(AudioFileCatalog.kSilenceTrackName, { data: silence, volume: 1.0 })
	}

	private static assignVolumePresets(): void {
		AudioFileCatalog.setVolume('call_center', 0.75)
		AudioFileCatalog.setVolume('coffee_shop', 0.75)
		AudioFileCatalog.setVolume('car_interior', 0.75)
		AudioFileCatalog.setVolume('city_street', 0.50)
		AudioFileCatalog.setVolume('subway', 0.20)
	}

	private static async loadAudioFiles(audioDir: string): Promise<void> {
		try {
			const files = await fs.readdir(audioDir)

			for (const file of files) {
				if (file.endsWith('.ulaw')) {
					const qualifiedFile = path.join(audioDir, file)

					const fileSize = await fs.stat(qualifiedFile).then((stats) => stats.size)
					if (fileSize > AudioFileCatalog.kMaxFileSizeBytes) {
						logger.warn(`File ${qualifiedFile} is too large (${fileSize} bytes)`)
						continue
					}

					AudioFileCatalog.totalBytesLoaded += fileSize

					const data = await fs.readFile(qualifiedFile)

					// parse only the filename without extension, and force to lowercase
					let key = path.parse(file).name
					key = key.toLowerCase()

					AudioFileCatalog.catalog.set(key, { data, volume: 1.0 })
				}
			}

			if (isDevelopment()) {
				logger.debug(
					`Loaded ${AudioFileCatalog.catalog.size} audio files` +
					` (${AudioFileCatalog.totalBytesLoaded / AudioFileCatalog.kBytesPerMegabyte} MB)`)
			}
		} catch (error) {
			logger.error('Error loading audio files: ', error)
		}
	}

}
