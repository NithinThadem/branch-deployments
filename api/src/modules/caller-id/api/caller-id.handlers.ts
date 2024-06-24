/* eslint-disable max-len */
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import { CallerIdEntity } from '../db/caller-id.entity'
import response from '../../../services/server/response'
import { TeamEntity } from '../../team/db/team.entity'
import { twilioClient } from '../../../services/twilio'
import { captureError } from '../../../util/error.util'
import { InterviewEntity } from '../../interview/db/interview.entity'
import dataSource from '../../../services/database/data-source'

export const getCallerIds = async (req: AuthenticatedRequest, res: Response) => {
	const { skip, limit } = req.query

	const [caller_ids, count] = await CallerIdEntity.createQueryBuilder('caller_id')
		.leftJoinAndSelect('caller_id.interviews', 'interviews')
		.where('caller_id.team_id = :team_id', { team_id: req.headers.team_id })
		.orderBy('caller_id.created', 'DESC')
		.skip(skip)
		.take(limit)
		.getManyAndCount()

	return response({
		res, data: {
			caller_ids,
			count,
		},
	})
}

export const createCallerId = async (req: AuthenticatedRequest, res: Response) => {
	const { phone_number } = req.body

	const team = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
	})

	const existing = await CallerIdEntity.findOne({
		where: {
			team,
			phone_number,
		},
	})

	if (existing) {
		return response({
			res,
			status: 400,
			data: {
				error: 'Caller ID is already verified',
			},
		})
	}

	const {
		validationCode,
	} = await twilioClient(team.twilio_account_sid, team.twilio_account_secret)
		.validationRequests
		.create({
			phoneNumber: phone_number,
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/caller-id-verification`,
		})
		.catch(error => {
			captureError(error)
			throw new Error('Failed to create validation request')
		})

	return response({
		res,
		data: {
			verification_code: validationCode,
		},
	})
}

export const deleteCallerId = async (req: AuthenticatedRequest, res: Response) => {
	const callerId = await CallerIdEntity.findOneOrFail({
		where: {
			id: req.params.caller_id,
			team_id: req.headers.team_id,
		},
		relations: ['team'],
	})

	await twilioClient(callerId.team.twilio_account_sid, callerId.team.twilio_account_secret).outgoingCallerIds(callerId.twilio_sid).remove()

	await callerId.remove()

	return response({
		res,
	})
}

export const connectCallerId = async (req: AuthenticatedRequest, res: Response) => {
	const callerId = await CallerIdEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
		relations: ['team'],
	})

	await dataSource.transaction(async (transactionalEntityManager) => {
		if (req.body.interview_ids.length === 0) {
			await transactionalEntityManager
				.createQueryBuilder()
				.update(InterviewEntity)
				.set({ caller_id: null })
				.where('team_id = :team_id AND caller_id = :caller_id', {
					team_id: req.headers.team_id,
					caller_id: callerId.id,
				})
				.execute()
		} else {
			await transactionalEntityManager
				.createQueryBuilder()
				.update(InterviewEntity)
				.set({ caller_id: callerId })
				.where('id IN (:...interview_ids) AND team_id = :team_id', {
					interview_ids: req.body.interview_ids,
					team_id: req.headers.team_id,
				})
				.execute()
		}
	})

	return response({
		res,
	})
}
