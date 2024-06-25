class MuLaw {

	private static readonly kBias = 0x84
	private static readonly kClip = 0x7FFF
	private static readonly MuLawCompressTable: Uint8Array = new Uint8Array([
		0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
		4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
		5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
		5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
		6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
	])

	private static readonly MuLawDecompressTable: Int16Array = new Int16Array([
		-32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
		-23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
		-15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
		-11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
		-7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
		-5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
		-3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
		-2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
		-1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
		-1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
		-876, -844, -812, -780, -748, -716, -684, -652,
		-620, -588, -556, -524, -492, -460, -428, -396,
		-372, -356, -340, -324, -308, -292, -276, -260,
		-244, -228, -212, -196, -180, -164, -148, -132,
		-120, -112, -104, -96, -88, -80, -72, -64,
		-56, -48, -40, -32, -24, -16, -8, -1,
		32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
		23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
		15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
		11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
		7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
		5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
		3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
		2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
		1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
		1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
		876, 844, 812, 780, 748, 716, 684, 652,
		620, 588, 556, 524, 492, 460, 428, 396,
		372, 356, 340, 324, 308, 292, 276, 260,
		244, 228, 212, 196, 180, 164, 148, 132,
		120, 112, 104, 96, 88, 80, 72, 64,
		56, 48, 40, 32, 24, 16, 8, 0,
	])

	public static encode(sample: number): number {
		const sign = (sample >> 8) & 0x80
		if (sign) { sample = -sample }
		if (sample > MuLaw.kClip) { sample = MuLaw.kClip }
		sample = sample + MuLaw.kBias
		const exponent = MuLaw.MuLawCompressTable[(sample >> 7) & 0xFF]
		const mantissa = (sample >> (exponent + 3)) & 0x0F
		const compressedByte = ~(sign | (exponent << 4) | mantissa)
		return compressedByte
	}

	public static decode(sample: number): number {
		return MuLaw.MuLawDecompressTable[sample]
	}

}

/**
 * MuLawAudioMixer is a class that provides methods for mixing
 * and adjusting the volume of 8-bit, μ-law, mono, 8kHz audio buffers.
 *
 * Helpful FFmpeg commands:
 *
 * 	Convert any input audio to a WAV file with 8kHz, 8-bit, mono, mu-law encoding:
 * 	ffmpeg -i input_audio.any -ar 8000 -ac 1 -c:a pcm_mulaw output_audio.wav
 *
 * 	Convert any input audio to a mu-law encoded raw audio file:
 * 	ffmpeg -i input_audio.any -ar 8000 -ac 1 -f mulaw output_audio.ulaw
 *
 * 	Convert a mu-law encoded raw audio file to a WAV file:
 * 	ffmpeg -f mulaw -ar 8000 -ac 1 -i input_audio.ulaw output_audio.wav
 *
 */
export class MuLawAudioMixer {

	// Normalize a 16-bit signed PCM sample to a floating point number in the range [-1, 1]
	static normalizePCM(sample: number): number {
		return sample / 32768
	}

	// Denormalize a floating point number in the range [-1, 1] to a 16-bit signed PCM sample
	static denormalizePCM(sample: number): number {
		return Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
	}

	public static mixWithVolume(buffer1: Buffer, buffer2: Buffer, volume1: number, volume2: number): Buffer {
		if (buffer1.length !== buffer2.length) { throw new Error('Audio buffers should be of equal size.') }

		volume1 = Math.max(0, Math.min(1, volume1))
		volume2 = Math.max(0, Math.min(1, volume2))

		const kLength = buffer1.length
		const output = Buffer.alloc(kLength)

		for (let i = 0; i < kLength; i++) {
			// decode mulaw and convert to 32-bit floating point PCM
			const sample1 = this.normalizePCM(MuLaw.decode(buffer1[i]))
			const sample2 = this.normalizePCM(MuLaw.decode(buffer2[i]))

			// apply volume factors
			const adjustedSample1 = sample1 * volume1
			const adjustedSample2 = sample2 * volume2

			let mixed = adjustedSample1 + adjustedSample2

			// clamp the mixed sample to the range [-1, 1]
			mixed = Math.max(-1, Math.min(1, mixed))

			// convert the mixed sample back to 8-bit mu-law
			output[i] = MuLaw.encode(this.denormalizePCM(mixed))
		}

		return output
	}

	public static mix(buffer1: Buffer, buffer2: Buffer): Buffer {
		if (buffer1.length !== buffer2.length) { throw new Error('Audio buffers should be of equal size.') }

		const kLength = buffer1.length
		const output = Buffer.alloc(kLength)

		for (let i = 0; i < kLength; i++) {
			// decode mulaw and convert to 32-bit floating point PCM
			const sample1 = this.normalizePCM(MuLaw.decode(buffer1[i]))
			const sample2 = this.normalizePCM(MuLaw.decode(buffer2[i]))

			let mixed = sample1 + sample2

			// clamp the mixed sample to the range [-1, 1]
			mixed = Math.max(-1, Math.min(1, mixed))

			// convert the mixed sample back to 8-bit mu-law
			output[i] = MuLaw.encode(this.denormalizePCM(mixed))
		}

		return output
	}

	public static volume(buffer: Buffer, factor: number): Buffer {
		factor = Math.max(0, Math.min(1, factor))

		const kLength = buffer.length
		const output = Buffer.alloc(kLength)

		for (let i = 0; i < kLength; i++) {
			let pcmSample = MuLaw.decode(buffer[i])
			let normalizedSample = this.normalizePCM(pcmSample)

			// apply volume factor
			normalizedSample *= factor

			// clamp the normalized sample to the range [-1, 1]
			normalizedSample = Math.max(-1, Math.min(1, normalizedSample))

			pcmSample = this.denormalizePCM(normalizedSample)
			output[i] = MuLaw.encode(pcmSample)
		}

		return output
	}

}
