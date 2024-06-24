/* eslint-disable max-len */
import { parsePhoneNumber } from 'awesome-phonenumber'
import * as Joi from 'joi'
import { join } from 'path'
import * as fs from 'fs'
import logger from './logger.util'
import { InterviewResponseEntity } from '../modules/interview-response/db/interview-response.entity'
import { PersonalityType } from '../modules/interview/db/interview.types'

export const getRequestIp = (req) =>
	req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress

export const escapeHTML = str => str.replace(/[&<>'"]/g,
	tag => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
		'"': '&quot;',
	}[tag]))

export function generateShortString(length: number) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	let result = ''

	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * chars.length)
		result += chars[randomIndex]
	}

	return result
}

export const standardizePhoneNumber = (value: string) => {
	const phoneNumber = parsePhoneNumber(value)
	if (phoneNumber.valid) {
		return phoneNumber.number.e164
	}
	return null
}

export const enumToJoiSchema = (e: object) => Joi.string()
	.valid(...Object.values(e).filter(i => isNaN(i)))

export const getCacheDirectory = () => {
	const cacheDirectory = join(process.cwd(), 'cache')

	if (!fs.existsSync(cacheDirectory)) {
		fs.mkdirSync(cacheDirectory)
	}

	return cacheDirectory
}

export const getAssetsDirectory = () => join(process.cwd(), 'assets')

export const separateNumberedList = (text: string) => {
	const regex = /\d+\.\s+(.*?)(?=\n|$)/g
	const matches = text.match(regex)

	if (matches) {
		return matches.map((match) => match.replace(/\d+\.\s+/, ''))
	} else {
		return []
	}
}

export const levenshteinDistance = (a: string, b: string) => {
	const dp: number[][] = Array(a.length + 1)
		.fill(null)
		.map(() => Array(b.length + 1).fill(0))

	for (let i = 0; i <= a.length; i++) {
		dp[i][0] = i
	}

	for (let j = 0; j <= b.length; j++) {
		dp[0][j] = j
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1]
			} else {
				dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
			}
		}
	}

	return dp[a.length][b.length]
}

export const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
	let dotProduct = 0
	let norm1 = 0
	let norm2 = 0

	for (let i = 0; i < vec1.length; i++) {
		dotProduct += vec1[i] * vec2[i]
		norm1 += vec1[i] * vec1[i]
		norm2 += vec2[i] * vec2[i]
	}

	norm1 = Math.sqrt(norm1)
	norm2 = Math.sqrt(norm2)

	if (norm1 === 0 || norm2 === 0) {
		return 0 // Handle zero vectors
	}

	return dotProduct / (norm1 * norm2)
}

export const getClosestString = (target: string, strings: string[]): string => {
	let closestString = ''
	let closestDistance = Infinity

	for (const string of strings) {
		const distance = levenshteinDistance(target, string)
		if (distance < closestDistance) {
			closestString = string
			closestDistance = distance
		}
	}

	return closestString
}

export async function withExponentialBackoff<T>(
	fetchFunc: () => Promise<T>,
	maxRetries = 5,
	retryDelay = 1000
): Promise<T> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			return await fetchFunc()
		} catch (error) {
			logger.warn(`Retrying in ${(retryDelay * 2 ** i) / 1000}s (${i + 1}/${maxRetries}) after error: ${error}`)
			if (i === maxRetries - 1) {
				throw error
			}
			await new Promise((resolve) => setTimeout(resolve, retryDelay * 2 ** i))
		}
	}
	throw new Error('Max retries exceeded')
}

export const getLanguageName = (languageCode: string) => new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode)

export const getTeamNamePronunciation = (interviewResponse: InterviewResponseEntity) => {
	const team = interviewResponse.interview.team
	return team?.name_pronunciation || team?.name || 'Thoughtly'
}

export const getTeamName = (interviewResponse: InterviewResponseEntity) => {
	const team = interviewResponse.interview.team
	return team?.name || 'Thoughtly'
}

export function snakeCaseToTitleCase(input: string): string {
	const words = input.split('_')
	const titleCaseWords = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
	return titleCaseWords.join(' ')
}

export const formatCallSummaryEvents = (events) => events.map((event, index) => `${index + 1}. ${event.bullet_point_description}`).join('<br>')

export const formatTagsAsBulletPoints = (tags) => tags.map((tag, index) => `${index + 1}. ${tag}`).join('<br>')

export function getPersonalityPrompt(lines: string[], personalityType: PersonalityType, level: number): string {
	const personalityTypeHeader = `**${PersonalityType[personalityType].charAt(0).toUpperCase()}${PersonalityType[personalityType].slice(1)} Prompts**`

	const personalityStartIndex = lines.findIndex(line => line.startsWith(personalityTypeHeader)) + 1
	const personalityEndIndex = lines.findIndex((line, index) => index > personalityStartIndex && line.startsWith('**')) || lines.length
	const personalityPrompts = lines.slice(personalityStartIndex, personalityEndIndex)

	const prompt = personalityPrompts[level - 1]?.replace(/^\d+\.\s*/, '').trim() || `No specific guidance found for ${personalityType.toLowerCase()} level.`
	return `${PersonalityType[personalityType].toUpperCase()} CUSTOMIZATION PROMPT: ${prompt}`
}

export const ratioBetween = (a: number, b: number, num: number) => {
	let ratio

	if (a < b) {
		ratio = (num - a) / (b - a)
	} else {
		ratio = (a - num) / (a - b)
	}

	return Math.max(0, Math.min(1, ratio))
}

type Vector = number[];
type Vocabulary = Map<string, number>;

function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/).filter(Boolean)
}

function createVocabulary(texts: string[]): Vocabulary {
	const vocabulary = new Map<string, number>()
	let index = 0
	texts.forEach(text => {
		tokenize(text).forEach(word => {
			if (!vocabulary.has(word)) {
				vocabulary.set(word, index++)
			}
		})
	})
	return vocabulary
}

function textToVector(text: string, vocabulary: Vocabulary): Vector {
	const vector = new Array(vocabulary.size).fill(0)
	tokenize(text).forEach(word => {
		if (vocabulary.has(word)) {
			vector[vocabulary.get(word)]++
		}
	})
	return vector
}

export function vectorizeTexts(text1: string, text2: string): [Vector, Vector] {
	const combinedTexts = [text1, text2]
	const vocabulary = createVocabulary(combinedTexts)
	const vector1 = textToVector(text1, vocabulary)
	const vector2 = textToVector(text2, vocabulary)
	return [vector1, vector2]
}

export function normalizePhoneNumbers(country_code: string, numbers: string[]) {
	if (!country_code.startsWith('+')) {
		country_code = `+${country_code}`
	}

	return numbers.map(number => {
		const parsed = parsePhoneNumber(number)
		if (parsed.valid) {
			logger.info('valid number', parsed.number.e164)
			return parsed.number.e164
		} else {
			return null
		}
	})
}

