/* eslint-disable max-len */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { InterviewResponseEntity } from '../../modules/interview-response/db/interview-response.entity'
import { Pov } from '../../modules/interview-deliverable/db/interview-deliverable.types'
import { getLanguageName, getPersonalityPrompt, getTeamName } from '../../util/helpers.util'
import { formatTranscript } from '../../modules/interview-response/api/interview-response.helpers'
import { ContactEntity } from '../../modules/contact/db/contact.entity'
import * as moment from 'moment'
import { PersonalityType } from '../../modules/interview/db/interview.types'
import { SummaryData } from '../../modules/interview-response/db/interview-response.types'

const getFile = (path: string) => readFile(join(__dirname, path)).then((buffer) => buffer.toString())

export const getPrompt = {
	createInterview: async ({
		topic,
		duration_mins,
	}: {
		topic: string
		duration_mins: string
	}): Promise<string> =>
		getFile('../../../lib/create-interview.txt').then(file => file
			.replace(/{topic}/g, topic)
			.replace(/{duration_mins}/g, duration_mins)
		),
	interviewEnd: ({
		interviewResponse,
	}: {
		interviewResponse: InterviewResponseEntity
	}) => getFile('../../../lib/interview-end.txt').then(file => file
		.replace(/{team_name}/g, getTeamName(interviewResponse))
	),
	generateBlogPost: async (
		{ interviewResponse, pov }: { interviewResponse: InterviewResponseEntity; pov: Pov }
	): Promise<string> =>
		getFile('../../../lib/deliverables/blog-post.txt').then(file => file
			.replace(/{subject}/g, interviewResponse.contact.name)
			.replace(/{pov}/g, pov)
			.replace(/{transcript}/g, formatTranscript(interviewResponse))
			.replace(/{author}/g, pov === Pov.FIRST ? interviewResponse.contact.name : getTeamName(interviewResponse))
		),
	generateLinkedInPost: async (
		{ interviewResponse }: { interviewResponse: InterviewResponseEntity; }
	): Promise<string> =>
		getFile('../../../lib/deliverables/linkedin-post.txt').then(file => file
			.replace(/{subject_name}/g, interviewResponse.contact.name)
			.replace(/{transcript}/g, formatTranscript(interviewResponse))
		),
	generateCaseStudy: async (
		{ interviewResponse }: { interviewResponse: InterviewResponseEntity; }
	): Promise<string> =>
		getFile('../../../lib/deliverables/case-study.txt').then(file => file
			.replace(/{subject_name}/g, interviewResponse.contact.name)
			.replace(/{team_name}/g, getTeamName(interviewResponse))
			.replace(/{transcript}/g, formatTranscript(interviewResponse))
		),
	startCall: async ({
		team_name,
		language,
		greeting,
		type,
		contact,
		objective,
		assertiveness_level_prompt,
		humor_level_prompt,
		timezone,
		previousCallSummaries,
	}: {
		team_name: string;
		language?: string;
		greeting: string;
		type: string;
		contact?: ContactEntity;
		objective: string;
		assertiveness_level_prompt?: string;
		humor_level_prompt?: string;
		timezone: string;
		previousCallSummaries: SummaryData[];
	}): Promise<string> => {
		const personalityInstructions = (assertiveness_level_prompt || humor_level_prompt) ?
			`**Personality Instructions:**
				${assertiveness_level_prompt ? `${assertiveness_level_prompt}\n\n` : ''}
				${humor_level_prompt ? `${humor_level_prompt}\n\n` : ''}` : ''

		const cleanedSummaries = previousCallSummaries.length ? `**Call Memory:**
			${previousCallSummaries.map((summary) => `- **Summary**: ${summary.summary}. **Tags**: ${summary.response_tags.join(', ')}`).join('\n')}
			` : ''

		return getFile('../../../lib/start-call.txt').then(file => file
			.replace(/{team_name}/g, team_name)
			.replace(/{language}/g, getLanguageName(language || 'en'))
			.replace(/{greeting}/g, greeting)
			.replace(/{type}/g, type)
			.replace(/{NAME}/g, contact?.name?.split(' ')[0])
			.replace(/{date}/g, moment().tz(timezone).format('MMMM Do, YYYY, h:mm a'))
			.replace(/{objective}/g, objective)
			.replace(/(\*\*Call Memory:\*\*[\s\S]*?)(?=\*\*Personality Instructions:\*\*)/, cleanedSummaries)
			.replace(/(\*\*Personality Instructions:\*\*[\s\S]*?)(?=\*\*Script:\*\*)/, personalityInstructions)
		)
	},
	analysis: async ({
		questions,
		transcript,
	}: {
		questions: string[]
		transcript: string
	}): Promise<string> =>
		getFile('../../../lib/analysis.txt').then(file => file
			.replace(/{questions}/g, questions.join('\n- '))
			.replace(/{transcript}/g, transcript)
		),
	generateInterviewFlow: async ({
		transcripts,
	}: {
		transcripts: string[]
	}): Promise<string> =>
		getFile('../../../lib/generate-interview-flow.txt').then(file => file
			.replace(/{transcripts}/g, transcripts.join('\n------------------\n'))
		),
	analyzeInterviewResponse: async ({
		interviewResponse,
		tags,
	}: {
		interviewResponse: InterviewResponseEntity;
		tags: string[];
	}): Promise<string> => getFile('../../../lib/analyze-transcript.txt').then(file => {
		const tagsString = tags.join(', ')
		return file
			.replace(/{transcript}/g, formatTranscript(interviewResponse))
			.replace(/{tags}/g, tagsString)
			.replace(/{date}/g, moment().utc().format('MMMM Do, YYYY, h:mm a'))
	}),
	interimAnalysis: async ({
		conversation,
	}: {
		conversation: string
	}): Promise<string> =>
		getFile('../../../lib/interim-analysis.txt').then(file => file
			.replace(/{conversation}/g, conversation)
		),
	personalityPrompt: async ({
		assertiveness_level,
		humor_level,
	}: {
		assertiveness_level: number;
		humor_level: number;
	}): Promise<{ assertivenessPrompt?: string; humorPrompt?: string }> => {
		const fileContent = await getFile('../../../lib/personality-prompts.txt')

		const lines = fileContent.split('\n')
		const assertivenessPrompt = assertiveness_level > 0 ? getPersonalityPrompt(lines, PersonalityType.ASSERTIVENESS, assertiveness_level) : undefined
		const humorPrompt = humor_level > 0 ? getPersonalityPrompt(lines, PersonalityType.HUMOR, humor_level) : undefined

		return {
			assertivenessPrompt,
			humorPrompt,
		}
	},
	dataFromTranscript: async ({
		question,
		answers,
		transcript,
	}: {
		question: string
		answers: string[]
		transcript: string
	}): Promise<string> =>
		getFile('../../../lib/data-from-transcript.txt').then(file => file
			.replace(/{question}/g, question)
			.replace(/{answers}/g, answers.join('\n- '))
			.replace(/{transcript}/g, transcript)
		),
}
