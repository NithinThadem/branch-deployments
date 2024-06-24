import { Deepgram } from '@deepgram/sdk'
import { InterviewLanguage } from '../../modules/interview/db/interview.types'

export const getDeepgram = () => new Deepgram(process.env.DEEPGRAM_API_KEY)

// // https://developers.deepgram.com/docs/models-languages-overview

export const getModelByLanguage = (language: InterviewLanguage) => {
	switch (language) {
		case 'en': return 'nova-2'
		case 'es': return 'nova-2'
		case 'de': return 'nova-2'
		case 'fr': return 'nova-2'
		case 'pt': return 'nova-2'
		case 'nl': return 'nova-2'
		case 'hi': return 'nova-2'
		case 'it': return 'enhanced'
		case 'da': return 'enhanced'
		case 'pl': return 'enhanced'
		case 'uk': return 'general'
		case 'ru': return 'nova-2'
		case 'tr': return 'nova-2'
		default: return 'nova-2'
	}
}
