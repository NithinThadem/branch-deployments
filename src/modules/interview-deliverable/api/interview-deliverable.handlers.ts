/* eslint-disable max-len */
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../types'
import response from '../../../services/server/response'
import { InterviewDeliverableEntity } from '../db/interview-deliverable.entity'
import { captureError } from '../../../util/error.util'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { InterviewDeliverableType, Pov } from '../db/interview-deliverable.types'
import { generateBlogPost, generateCaseStudy, generateLinkedinPost } from '../db/interview-deliverable.helpers'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import analytics from '../../../services/segment'
import dataSource from '../../../services/database/data-source'
import { Brackets } from 'typeorm'

export const createDeliverable = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	if (req.body.type === 'VIDEO') {
		return response({ res, status: 501, error: 'Not implemented' })
	}

	const interview_response = await InterviewResponseEntity.findOneOrFail({
		where: {
			id: req.params.interview_response_id,
		},
		relations: ['interview', 'deliverables'],
	})

	if (interview_response.deliverables.find(deliverable => deliverable.type === req.body.type)) {
		return response({ res, status: 409, error: 'Already exists' })
	}

	try {
		await withExponentialBackoff(async () => {
			switch (req.body.type) {
				case InterviewDeliverableType.ARTICLE: {
					const {
						title,
						text,
						images,
					} = await generateBlogPost({
						interviewResponse: interview_response,
						pov: req.body.pov || Pov.FIRST,
					})

					const deliverable = await InterviewDeliverableEntity.create({
						interview_response: interview_response,
						type: req.body.type,
						title,
						content: text,
						image_urls: images,
						pov: req.body.pov || Pov.FIRST,
					}).save()

					return response({ res, data: deliverable })
				}
				case InterviewDeliverableType.LINKEDIN: {
					const {
						images,
						text,
					} = await generateLinkedinPost({
						interviewResponse: interview_response,
					})

					const deliverable = await InterviewDeliverableEntity.create({
						interview_response: interview_response,
						type: req.body.type,
						title: 'LinkedIn Post',
						content: text,
						image_urls: images,
					}).save()

					return response({ res, data: deliverable })
				}
				case InterviewDeliverableType.CASE_STUDY: {
					const {
						images,
						title,
						text,
					} = await generateCaseStudy({
						interviewResponse: interview_response,
					})

					const deliverable = await InterviewDeliverableEntity.create({
						interview_response: interview_response,
						type: req.body.type,
						title,
						content: text,
						image_urls: images,
					}).save()

					analytics.track({
						userId: user.id,
						event: 'Deliverable Created',
						properties: {
							deliverable_type: req.body.type,
							interview_response_id: req.params.interview_response_id,
							team_id: deliverable.interview_response.team_id,
						},
					})

					return response({ res, data: deliverable })
				}
			}
		}, 3, 20 * 1000)
	} catch (error) {
		captureError(error)
		return response({ res, status: 500, error: 'Internal server error' })
	}
}

export const getDeliverables = async (req: AuthenticatedRequest, res: Response) => {
	const resultsPerPage = req.query.limit || 10
	const page = req.query.page || 0
	const responseTags = req.query.response_tags || []
	const interviewId = req.query.interview_id
	const sort = req.query.sort || 'created_desc'

	const queryBuilder = dataSource
		.createQueryBuilder(InterviewDeliverableEntity, 'deliverable')
		.leftJoinAndSelect('deliverable.interview_response', 'interview_response')
		.leftJoinAndSelect('interview_response.interview', 'interview')
		.leftJoinAndSelect('interview_response.contact', 'contact')
		.where('interview.team.id = :teamId', { teamId: req.headers.team_id })

	if (req.query.interview_id) {
		queryBuilder.andWhere('interview.id = :interviewId', { interviewId })
	}

	if (responseTags.length > 0) {
		queryBuilder.andWhere(`
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(interview_response.summary_data->'response_tags') AS tag
            WHERE tag = ANY(:responseTags)
        )
    `, { responseTags })
	}

	if (req.query.search) {
		queryBuilder.andWhere(new Brackets(qb => {
			qb.where('deliverable.content ILike :searchText', { searchText: `%${req.query.search}%` })
				.orWhere('deliverable.title ILike :searchText', { searchText: `%${req.query.search}%` })
				.orWhere('interview_response.conversation_history::text ILike :searchText', { searchText: `%${req.query.search}%` })
		}))
	}
	let sortDirection: 'ASC' | 'DESC' = 'DESC'
	if (sort === 'created_asc') {
		sortDirection = 'ASC'
	}

	queryBuilder.orderBy('deliverable.created', sortDirection)

	const count = await queryBuilder.getCount()

	const deliverables = await queryBuilder
		.take(resultsPerPage)
		.skip(page * resultsPerPage)
		.getMany()

	const tagsSet = new Set()

	if (interviewId) {
		deliverables.forEach(deliverable => {
			deliverable.interview_response?.summary_data?.response_tags.forEach(tag => tagsSet.add(tag))
			deliverable.interview_response?.interview.response_tags.forEach(tag => tagsSet.add(tag))
		})
	}

	return response({
		res,
		data: {
			deliverables,
			count,
			all_tags: Array.from(tagsSet),
		},
	})
}
