import { Request, Response } from 'express'
import { synthesizeSpeech } from '../interview/api/interview.helpers'
import EventUtil from '../../services/event'
import response from '../../services/server/response'
import ElevenLabs from '../../services/elevenlabs'
import { playht } from '../../services/playht'
import { TeamEntity } from '../team/db/team.entity'
import dataSource from '../../services/database/data-source'
import { masterTwilioClient } from '../../services/twilio'
import { withExponentialBackoff } from '../../util/helpers.util'
import { getTeamUsedMinutes } from '../../modules/subscription/db/subscription.helpers'

export const getElevenLabsVoices = async (req: Request, res: Response) => {
	const data = await ElevenLabs.getVoices()
	return response({ res, data })
}

export const getElevenLabsModels = async (req: Request, res: Response) => {
	const data = await ElevenLabs.getModels()
	return response({ res, data })
}

export const generateTts = async (req: Request, res: Response) => {
	const { text, aiName } = req.body

	const audioBuffer = await synthesizeSpeech(text, aiName)

	res.setHeader('Content-Disposition', `attachment; filename="tts-${Date.now()}.mp3"`)
	res.setHeader('Content-Type', 'audio/mpeg')

	res.status(200).send(audioBuffer)
}

export const emitEvent = async (req: Request, res: Response) => {
	await EventUtil.asyncEmit(req.body.event, req.body.data)
	return response({ res })
}

export const getPlayHtVoices = async (req: Request, res: Response) => {
	const data = await playht().listVoices()
	return response({ res, data })
}

export const getAllTeams = async (req: Request, res: Response) => {
	const searchTerm = req.query.search || ''
	const resultsPerPage = parseInt(req.query.limit || '25')
	const page = parseInt(req.query.page || '0')

	try {
		const countQuery = dataSource
			.createQueryBuilder(TeamEntity, 'team')
			.where('team.name ILike :searchTerm', { searchTerm: `%${searchTerm}%` })

		const count = await countQuery.getCount()

		const teamsQuery = dataSource
			.createQueryBuilder(TeamEntity, 'team')
			.leftJoinAndSelect('team.user_teams', 'userTeams')
			.leftJoinAndSelect('userTeams.user', 'user')
			.leftJoinAndSelect('team.subscriptions', 'subscriptions')
			.where('team.name ILike :searchTerm', { searchTerm: `%${searchTerm}%` })
			.orWhere(qb => {
				const subQuery = qb.subQuery()
					.select('userTeams.team_id')
					.from('user_teams', 'userTeams')
					.where('userTeams.user_id = user.id')
					.andWhere('user.email ILIKE :email', { email: `%${searchTerm}%` })
					.getQuery()
				return 'team.id IN ' + subQuery
			})
			.orderBy('team.name', 'ASC')
			.take(resultsPerPage)
			.skip(page * resultsPerPage)

		const teams = await teamsQuery.getMany()

		const publicTeams = await Promise.all(teams.map(async team => {
			const publicTeam = await team.toPublic()
			const userCount = publicTeam.users.length
			return {
				...publicTeam,
				user_count: userCount,
				used_minutes: await getTeamUsedMinutes(team),
			}
		}))

		return response({
			res,
			data: {
				teams: publicTeams,
				count,
			},
		})
	} catch (error) {
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}

export const getTwilioTrustHubPolicies = async (req: Request, res: Response) => {
	const policies = await withExponentialBackoff(async () => await masterTwilioClient().trusthub.v1.policies.list())
	return response({ res, data: policies })
}
