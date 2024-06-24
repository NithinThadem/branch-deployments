import GoogleSpeech from '@google-cloud/speech'
import GoogleTextToSpeech from '@google-cloud/text-to-speech'
import { join } from 'path'

const args = {
	projectId: process.env.GCP_PROJECT_ID,
	keyFilename: join(
		process.cwd(),
		process.env.GCP_SA_KEY_PATH || './service-account.json'
	),
}

export const speechToText = new GoogleSpeech.SpeechClient(args)
export const textToSpeech = new GoogleTextToSpeech.TextToSpeechClient(args)
