import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { getPrompt } from '../../../services/prompts'
import unsplash from '../../../services/unsplash'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { Pov } from './interview-deliverable.types'

export const generateBlogPost = async ({
	interviewResponse,
	pov,
}: {
	interviewResponse: InterviewResponseEntity
	pov: Pov
}) => {
	const [{ choices: [{ message }] }] = await Promise.all([
		azureAi({ model: AzureOpenAIModels.GPT_3_5_TURBO_16K }).chat.completions.create({
			model: OpenAIModels.GPT_3_5_TURBO_16K,
			temperature: 0.5,
			messages: [{
				role: 'system',
				content: await getPrompt.generateBlogPost({
					interviewResponse,
					pov,
				}),
			}],
			function_call: {
				name: 'create_article',
			},
			functions: [{
				name: 'create_article',
				description: 'Creates an article.',
				parameters: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'The title of the article.',
						},
						unsplash_image_search: {
							type: 'string',
							description: 'The search query for an image from Unsplash.',
						},
						sections: {
							type: 'array',
							description: 'The sections of the article.',
							items: {
								type: 'object',
								properties: {
									section_heading: {
										type: 'string',
										description: 'The heading of the section.',
									},
									section_content: {
										type: 'array',
										description: 'The content of the section, split by many paragraphs. ' +
											'Please provide multiple paragraphs.',
										items: {
											type: 'string',
											description: 'The content of the paragraph.',
										},
									},
								},
							},
						},
					},
				},
			}],
		}),
	])

	const {
		title,
		sections,
		unsplash_image_search,
	} = JSON.parse(message.function_call.arguments)

	let images = []
	try {
		const { response: { results } } = await unsplash.search.getPhotos({
			query: unsplash_image_search,
		})
		images = results.map(({ urls }) => urls.regular)
	} catch (error) {
		console.error('Failed to fetch images:', error)
	}
	return {
		title,
		sections,
		images,
		text: sections.map(({ section_content, section_heading }) => [
			`## ${section_heading}`,
			...section_content.map((paragraph) => `${paragraph}`),
		].join('\n\n')).join('\n\n'),
	}
}

export const generateLinkedinPost = async ({
	interviewResponse,
}: {
	interviewResponse: InterviewResponseEntity
}) => {
	const [{ choices: [{ message }] }] = await Promise.all([
		azureAi({ model: AzureOpenAIModels.GPT_3_5_TURBO_1106 }).chat.completions.create({
			model: OpenAIModels.GPT_3_5_TURBO,
			temperature: 0.5,
			messages: [{
				role: 'system',
				content: await getPrompt.generateLinkedInPost({
					interviewResponse,
				}),
			}],
			function_call: {
				name: 'create_linkedin_post',
			},
			functions: [{
				name: 'create_linkedin_post',
				description: 'Creates a LinkedIn post with an image from Unsplash.',
				parameters: {
					type: 'object',
					properties: {
						content: {
							type: 'string',
							description: 'The contents of the post.',
						},
						unsplash_image_search: {
							type: 'string',
							description: 'The search query for an image from Unsplash.',
						},
					},
				},
			}],
		}),
	])

	const {
		content,
		unsplash_image_search,
	} = JSON.parse(message.function_call.arguments)

	let images = []
	try {
		const { response: { results } } = await unsplash.search.getPhotos({
			query: unsplash_image_search,
		})
		images = results.map(({ urls }) => urls.regular)
	} catch (error) {
		console.error('Failed to fetch images:', error)
	}

	return {
		images,
		text: content,
	}
}

export const generateCaseStudy = async ({
	interviewResponse,

}: {
	interviewResponse: InterviewResponseEntity
}) => {
	const [{ choices: [{ message }] }] = await Promise.all([
		azureAi({ model: AzureOpenAIModels.GPT_3_5_TURBO_16K }).chat.completions.create({
			model: OpenAIModels.GPT_3_5_TURBO_16K,
			temperature: 0.5,
			messages: [{
				role: 'system',
				content: await getPrompt.generateCaseStudy({
					interviewResponse,
				}),
			}],
			function_call: {
				name: 'create_case_study',
			},
			functions: [{
				name: 'create_case_study',
				description: 'Creates a case study.',
				parameters: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'The title of the case study.',
						},
						unsplash_image_search: {
							type: 'string',
							description: 'The search query for an image from Unsplash.',
						},
						sections: {
							type: 'array',
							description: 'The sections of the case study.',
							items: {
								type: 'object',
								properties: {
									section_heading: {
										type: 'string',
										description: 'The heading of the section.',
									},
									section_content: {
										type: 'array',
										description: 'The content of the section, split by many paragraphs. ' +
											'Please provide multiple paragraphs.',
										items: {
											type: 'string',
											description: 'The content of the paragraph.',
										},
									},
								},
							},
						},
					},
				},
			}],
		}),
	])

	const {
		title,
		sections,
		unsplash_image_search,
	} = JSON.parse(message.function_call.arguments)

	let images = []
	try {
		const { response: { results } } = await unsplash.search.getPhotos({
			query: unsplash_image_search,
		})
		images = results.map(({ urls }) => urls.regular)
	} catch (error) {
		console.error('Failed to fetch images:', error)
	}

	return {
		images,
		title,
		sections,
		text: sections.map(({ section_content, section_heading }) => [
			`## ${section_heading}`,
			...section_content.map((paragraph) => `${paragraph}`),
		].join('\n\n')).join('\n\n'),
	}
}
