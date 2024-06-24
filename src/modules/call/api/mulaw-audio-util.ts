export class MuLawAudioUtil {

	public static readonly Channels = 1
	public static readonly SampleRate = 8000
	public static readonly BytesPerSample = 1

	public static kBytesPerSecond = MuLawAudioUtil.getAudioBufferBytes(1)

	/**
	 * Analyze the audio buffer and return the duration in seconds
	 * @param buf Buffer with 8-bit, mu-law, mono, 8kHz audio
	 * @returns Duration in seconds
	 */
	public static getAudioBufferDuration(buf: Buffer): number {
		const numberOfSamples = buf.length / (MuLawAudioUtil.Channels * MuLawAudioUtil.BytesPerSample)
		return numberOfSamples / MuLawAudioUtil.SampleRate
	}

	public static getAudioBufferDurationFromString(payload: string): number {
		const buf = Buffer.from(payload, 'base64')
		return MuLawAudioUtil.getAudioBufferDuration(buf)
	}

	// Get the number of bytes required for a given duration in seconds
	public static getAudioBufferBytes(seconds: number): number {
		return MuLawAudioUtil.SampleRate * MuLawAudioUtil.BytesPerSample * seconds * MuLawAudioUtil.Channels
	}

	public static createSilenceBuffer(seconds: number): Buffer {
		const bytes = MuLawAudioUtil.getAudioBufferBytes(seconds)
		const buf = Buffer.alloc(bytes)

		// generate mu-law silence
		for (let i = 0; i < bytes; i++) {
			buf[i] = 0xff
		}

		return buf
	}

}
