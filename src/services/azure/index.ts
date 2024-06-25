// import OpenAI from 'openai'

// const useHelicone = process.env.HELICONE_API_KEY !== undefined

// export type AzureOpenAIConfig = {
// 	team_id?: string
// 	'Helicone-Property-Feature'?: string
// 	'Helicone-Property-InterviewId'?: string
// 	'Helicone-Property-InterviewResponseId'?: string
// 	model: string
// }
// export const azureAi = (args?: AzureOpenAIConfig) => {
// 	let apiVersion = '2024-04-01-preview'
// 	switch (args.model) {
// 		case AzureOpenAIModels.GPT_4_O:
// 			apiVersion = '2024-04-01-preview'
// 			break
// 		case AzureOpenAIModels.GPT_4:
// 			apiVersion = 'turbo-2024-04-09'
// 			break
// 		case AzureOpenAIModels.GPT_3_5_TURBO_16K:
// 		case AzureOpenAIModels.GPT_3_5_TURBO_1106:
// 			apiVersion = '0613'
// 			break
// 		default:
// 			break
// 	}

// 	const deploymentName = args.model || 'gpt-4o'

// 	return new OpenAI({
// 		baseURL: useHelicone ?
// 			`https://oai.helicone.ai/openai/deployments/${deploymentName}` :
// 			`${process.env.AZURE_OPENAI_ENDPOINT}/deployments/${deploymentName}`,
// 		defaultHeaders: useHelicone ? {
// 			'api-key': process.env.AZURE_OPENAI_KEY,
// 			'Helicone-OpenAI-API-Base': process.env.AZURE_OPENAI_ENDPOINT,
// 			'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
// 			'Helicone-User-Id': args?.team_id || '',
// 			'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
// 			'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
// 			'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
// 			'Helicone-Property-Environment': process.env.NODE_ENV || '',
// 		} : undefined,
// 		defaultQuery: {
// 			'api-version': apiVersion,
// 		},
// 	})
// }
// export enum AzureOpenAIModels {
// 	GPT_4 = 'gpt-4',
// 	GPT_3_5_TURBO_16K = 'gpt-35-turbo-16k',
// 	GPT_3_5_TURBO_1106 = 'gpt-35-turbo-1106', // 1106 not available in Azure
// 	GPT_4_O = 'gpt-4o',
// }

// import OpenAI from 'openai'

// const useHelicone = process.env.HELICONE_API_KEY !== undefined

// export type AzureOpenAIConfig = {
// 	team_id?: string
// 	'Helicone-Property-Feature'?: string
// 	'Helicone-Property-InterviewId'?: string
// 	'Helicone-Property-InterviewResponseId'?: string
// 	model: string
// }
// export const azureAi = (args?: AzureOpenAIConfig) => {
// 	let apiVersion = '2024-04-01-preview'
// 	switch (args.model) {
// 		case AzureOpenAIModels.GPT_4_O:
// 			apiVersion = '2024-04-01-preview'
// 			break
// 		case AzureOpenAIModels.GPT_4:
// 			apiVersion = 'turbo-2024-04-09'
// 			break
// 		case AzureOpenAIModels.GPT_3_5_TURBO_16K:
// 		case AzureOpenAIModels.GPT_3_5_TURBO_1106:
// 			apiVersion = '0613'
// 			break
// 		default:
// 			break
// 	}

// 	const deploymentName = args.model || 'gpt-4o'

// 	return new OpenAI({
// 		baseURL: useHelicone ?
// 			`https://oai.helicone.ai/openai/deployments/${deploymentName}` :
// 			`${process.env.AZURE_OPENAI_ENDPOINT}/deployments/${deploymentName}`,
// 		defaultHeaders: useHelicone ? {
// 			'api-key': process.env.AZURE_OPENAI_KEY,
// 			'Helicone-OpenAI-API-Base': process.env.AZURE_OPENAI_ENDPOINT,
// 			'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
// 			'Helicone-User-Id': args?.team_id || '',
// 			'Helicone-Property-Feature': args?.['Helicone-Property-Feature'] || '',
// 			'Helicone-Property-InterviewId': args?.['Helicone-Property-InterviewId'] || '',
// 			'Helicone-Property-InterviewResponseId': args?.['Helicone-Property-InterviewResponseId'] || '',
// 			'Helicone-Property-Environment': process.env.NODE_ENV || '',
// 		} : undefined,
// 		defaultQuery: {
// 			'api-version': apiVersion,
// 		},
// 	})
// }
// export enum AzureOpenAIModels {
// 	GPT_4 = 'gpt-4',
// 	GPT_3_5_TURBO_16K = 'gpt-35-turbo-16k',
// 	GPT_3_5_TURBO_1106 = 'gpt-35-turbo-1106', // 1106 not available in Azure
// 	GPT_4_O = 'gpt-4o',
// }

import OpenAI from 'openai'

export type OpenAIConfig = {
	team_id: string
	'Helicone-Property-Feature': string
	'Helicone-Property-InterviewId': string
	'Helicone-Property-InterviewResponseId': string
	model?: string
}

const useHelicone = process.env.HELICONE_API_KEY !== undefined

export const azureAi = (args?: Partial<OpenAIConfig>) => new OpenAI({
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

export enum AzureOpenAIModels {
	GPT_4 = 'gpt-4',
	GPT_3_5_TURBO = 'gpt-3.5-turbo',
	GPT_3_5_TURBO_16K = 'gpt-3.5-turbo-16k',
	GPT_3_5_TURBO_1106 = 'gpt-3.5-turbo-1106',
	GPT_4_32K = 'gpt-4-32k',
	GPT_4_TURBO = 'gpt-4-turbo',
	GPT_4_O = 'gpt-4o',
}
