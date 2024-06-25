import { AudioFileCatalog } from './audio-file-catalog'

/**
 * A simple class to read raw audio data from buffer.
 * The data is read in a circular fashion, so the same data is repeated indefinitely.
 */
export class AudioFileReader {

	private bytePosition: number
	private catalogName: string

	constructor(catalogName: string) {
		this.bytePosition = AudioFileCatalog.getRandomTrackPosition(catalogName)
		this.catalogName = catalogName
	}

	public get Name(): string {
		return this.catalogName
	}

	public get position(): number {
		return this.bytePosition
	}

	public set position(value: number) {
		this.bytePosition = value
	}

	public read(bytes: number): Buffer {
		return AudioFileCatalog.read(this, bytes)
	}

}
