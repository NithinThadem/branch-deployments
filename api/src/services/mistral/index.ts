import OpenAI from 'openai'
import { OpenAIConfig } from '../openai'

const useHelicone = process.env.HELICONE_API_KEY !== undefined

export const mistral = (args?: Partial<OpenAIConfig>) => new OpenAI({
	apiKey: process.env.MISTRAL_API_KEY,
	baseURL: useHelicone ? 'https://oai.hconeai.com/v1' : 'https://api.mistral.ai/v1',
	defaultHeaders: useHelicone ? {
		'Helicone-OpenAI-API-Base': 'https://api.mistral.ai/v1',
		'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
		'Helicone-User-Id': args?.team_id || '',
		'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
		'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
		'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
		'Helicone-Property-Environment': process.env.NODE_ENV || '',
	} : undefined,
})

export enum MistralModels {
	LARGE = 'mistral-large-latest',
	MEDIUM = 'mistral-medium',
	SMALL = 'mistral-small',
	MIXTRAL_8x22b = 'open-mixtral-8x22b',
	MIXTRAL_8x7b = 'open-mixtral-8x7b',
	MIXTRAL_7b = 'open-mistral-7b'
}
