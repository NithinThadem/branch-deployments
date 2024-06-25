/* eslint-disable max-len */

import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import dataSource from '../../../services/database/data-source'
import { InterviewFolderEntity } from '../db/interview-folder.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { InterviewFlowEntity } from '../../interview-flow/db/interview-flow.entity'
import { TeamEntity } from '../../team/db/team.entity'

export const getInterviewsByFolder = async (req: AuthenticatedRequest, res: Response) => {
	const searchText = req.query.search || ''
	const status = req.query.status
	const resultsPerPage = parseInt(req.query.limit) || 25
	const page = parseInt(req.query.page) || 0

	const teamSubscription = await TeamEntity.findOneOrFail({
		where: {
			id: req.headers.team_id,
		},
		relations: ['subscriptions'],
	})

	const hasAgencySubscription = teamSubscription.subscriptions.some(subscription => subscription.plan === 'AGENCY')

	if (!hasAgencySubscription) {
		// return null data instead of error
		return response({ res, data: { folders: [], count: 0 } })
	}

	const offset = page * resultsPerPage
	const teamId = req.headers.team_id

	const sqlQuery = `
	SELECT
    	folder.id AS folder_id,
    	folder.name AS folder_name,
    	interview.id AS interview_id,
    	interview.title AS interview_title,
    	interview.type AS interview_type,
    	interview.created AS interview_created,
    	interview.ai_name AS interview_ai_name,
    	COALESCE(sub.interview_count, 0) AS interview_count,
    	COALESCE(resp.response_count, 0) AS response_count
	FROM
    	(SELECT f.id
     	FROM interview_folder f
     	WHERE f.team_id = $1
       		AND f.name ILIKE $4
     	ORDER BY (
        	SELECT COUNT(interview.id)
        	FROM interview
       		WHERE interview.folder_id = f.id
     	) DESC
     	OFFSET $2 LIMIT $3) AS paginated_folders
	INNER JOIN interview_folder folder ON folder.id = paginated_folders.id
	LEFT JOIN interview ON folder.id = interview.folder_id
    	AND interview.status = $5
	LEFT JOIN (
    	SELECT folder.id AS folder_id, COUNT(interview.id) AS interview_count
    	FROM interview_folder folder
    	LEFT JOIN interview ON folder.id = interview.folder_id
    	GROUP BY folder.id
	) AS sub ON folder.id = sub.folder_id
	LEFT JOIN (
    	SELECT interview_id, COUNT(id) AS response_count
    	FROM interview_response
   	 GROUP BY interview_id
	) AS resp ON interview.id = resp.interview_id
	ORDER BY COALESCE(sub.interview_count, 0) DESC
`
	const queryResults = await dataSource.query(sqlQuery, [teamId, offset, resultsPerPage, `%${searchText}%`, status])

	const foldersMap = new Map()
	queryResults.forEach(row => {
		let folder = foldersMap.get(row.folder_id)

		if (!folder) {
			folder = {
				folder_id: row.folder_id,
				folder_name: row.folder_name,
				interviews: [],
			}
			foldersMap.set(row.folder_id, folder)
		}

		if (row.interview_id !== null) {
			folder.interviews.push({
				id: row.interview_id,
				title: row.interview_title,
				type: row.interview_type,
				created: row.interview_created,
				ai_name: row.interview_ai_name,
				response_count: parseInt(row.response_count, 10),
				connected_users: [],
			})
		}
	})

	const formattedFolders = Array.from(foldersMap.values())

	const totalCountResult = await dataSource
		.createQueryBuilder()
		.select('COUNT(DISTINCT folder.id)', 'count')
		.from(InterviewFolderEntity, 'folder')
		.where('folder.team_id = :teamId', { teamId: req.headers.team_id })
		.getRawOne()

	const totalCount = parseInt(totalCountResult.count, 10)

	return response({
		res,
		data: {
			folders: formattedFolders,
			count: totalCount,
		},
	})
}

export const getAllFolders = async (req: AuthenticatedRequest, res: Response) => {
	const searchText = req.query.search || ''
	const teamId = req.query.team_id

	const foldersWithCounts = await dataSource
		.getRepository(InterviewFolderEntity)
		.createQueryBuilder('folder')
		.leftJoin('folder.interviews', 'interview')
		.where('folder.team_id = :teamId', { teamId })
		.andWhere('folder.name ILike :searchText', { searchText: `%${searchText}%` })
		.select('folder.id', 'id')
		.addSelect('folder.name', 'name')
		.addSelect('COUNT(interview.id)', 'interviewCount')
		.groupBy('folder.id')
		.orderBy('folder.name', 'ASC')
		.getRawMany()

	const formattedFolders = foldersWithCounts.map(folder => ({
		...folder,
		interview_count: parseInt(folder.interviewCount, 10),
	}))
	return response({ res, data: formattedFolders })
}

export const createInterviewFolder = async (req: AuthenticatedRequest, res: Response) => {
	const folder = await InterviewFolderEntity.create({
		team: {
			id: req.headers.team_id,
		},
		name: req.body.name,
	}).save()

	return response({ res, data: folder })
}

export const deleteInterviewFolder = async (req: AuthenticatedRequest, res: Response) => {
	const folder = await InterviewFolderEntity.findOneOrFail({
		where: {
			id: req.params.folder_id,
		},
		relations: ['team'],
	})

	if (folder.team.id !== req.headers.team_id) {
		return response({ res, status: 403, error: 'Forbidden' })
	}

	await folder.remove()

	return response({ res, data: folder })
}

export const moveInterviewsToFolder = async (req: AuthenticatedRequest, res: Response) => {
	const interviewId = req.body.interview_id
	const folderId = req.params.folder_id

	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: interviewId,
		},
		relations: ['team', 'folder'],
	})

	if (folderId === 'null') {
		interview.folder = null
	} else {
		const folder = await InterviewFolderEntity.findOneOrFail({
			where: {
				id: req.params.folder_id,
			},
			relations: ['team'],
		})

		if (folder.team.id !== interview.team.id) {
			return response({ res, status: 403, error: `Forbidden: Interview ID ${interviewId} belongs to a different team` })
		}

		interview.folder = folder
	}
	await interview.save()

	return response({ res, data: { message: 'Interviews added to folder successfully' } })
}

export const copyInterviewFolder = async (req: AuthenticatedRequest, res: Response) => {
	const originalFolderId = req.params.folder_id
	const currentTeamId = req.headers.team_id
	const newTeamId = req.body.team_id || currentTeamId
	const name = req.body.folder_name

	const originalFolder = await InterviewFolderEntity.findOne({
		where: { id: originalFolderId, team: { id: currentTeamId } },
	})

	if (!originalFolder) {
		return response({ res, status: 404, error: 'Original folder not found' })
	}

	const copiedFolder = await InterviewFolderEntity.create({
		team: {
			id: newTeamId,
		},
		name,
	}).save()

	const interviews = await dataSource
		.getRepository(InterviewEntity)
		.createQueryBuilder('interview')
		.leftJoinAndSelect('interview.flow', 'flow')
		.where('interview.folder_id = :folderId', { folderId: originalFolderId })
		.andWhere('interview.team_id = :teamId', { teamId: currentTeamId })
		.getMany()

	for (const interview of interviews) {
		const newInterview = InterviewEntity.create({
			team: { id: newTeamId },
			folder: copiedFolder,
			title: interview.title,
			type: interview.type,
		})
		await newInterview.save()

		if (interview.flow) {
			const newFlow = InterviewFlowEntity.create({
				interview_id: newInterview.id,
				nodes: interview.flow.nodes,
				edges: interview.flow.edges,
				functions: interview.flow.functions,
			})
			await newFlow.save()
		}
	}

	return response({ res, data: copiedFolder })
}
