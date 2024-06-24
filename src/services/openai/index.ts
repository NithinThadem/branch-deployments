import OpenAI from 'openai'

export type OpenAIConfig = {
	team_id: string
	'Helicone-Property-Feature': string
	'Helicone-Property-InterviewId': string
	'Helicone-Property-InterviewResponseId': string
	model?: string
}

const useHelicone = process.env.HELICONE_API_KEY !== undefined

const openai = (args?: Partial<OpenAIConfig>) => new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
	baseURL: useHelicone ? 'https://oai.hconeai.com/v1' : undefined,
	defaultHeaders: useHelicone ? {
		'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
		'Helicone-User-Id': args?.team_id || '',
		'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
		'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
		'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
		'Helicone-Property-Environment': process.env.NODE_ENV || '',
	} : undefined,
})

export default openai

export enum OpenAIModels {
	GPT_4 = 'gpt-4',
	GPT_3_5_TURBO = 'gpt-3.5-turbo',
	GPT_3_5_TURBO_16K = 'gpt-3.5-turbo-16k',
	GPT_3_5_TURBO_1106 = 'gpt-3.5-turbo-1106',
	GPT_4_32K = 'gpt-4-32k',
	GPT_4_TURBO = 'gpt-4-turbo',
	GPT_4_O = 'gpt-4o',
}
