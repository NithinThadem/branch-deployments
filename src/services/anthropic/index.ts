import Anthropic from '@anthropic-ai/sdk'

export type ClaudeConfig = {
	team_id: string
	'Helicone-Property-Feature': string
	'Helicone-Property-InterviewId': string
	'Helicone-Property-InterviewResponseId': string
}

const useHelicone = process.env.HELICONE_API_KEY !== undefined

export const claude = (args?: Partial<ClaudeConfig>) => new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
	baseURL: useHelicone ? 'https://anthropic.hconeai.com/' : undefined,
	defaultHeaders: useHelicone ? {
		'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
		'Helicone-User-Id': args?.team_id || '',
		'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
		'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
		'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
		'Helicone-Property-Environment': process.env.NODE_ENV || '',
	} : undefined,
})

export enum ClaudeModels {
	CLAUDE_3_OPUS = 'claude-3-opus-20240229',
	CLAUDE_3_HAIKU = 'claude-3-haiku-20240307'

}
