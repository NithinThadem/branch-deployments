import OpenAI from 'openai'
import { OpenAIConfig } from '../openai'

const useHelicone = process.env.HELICONE_API_KEY !== undefined

export const groq = (args?: Partial<OpenAIConfig>) => new OpenAI({
	apiKey: process.env.GROQ_API_KEY,
	baseURL: useHelicone ? 'https://groq.hconeai.com/openai/v1' : 'https://api.groq.com/openai/v1',
	defaultHeaders: useHelicone ? {
		'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
		'Helicone-User-Id': args?.team_id || '',
		'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
		'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
		'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
		'Helicone-Property-Environment': process.env.NODE_ENV || '',
	} : undefined,
})

export enum GroqModels {
	LLAMA_3_70B = 'llama3-70b-8192',
}
