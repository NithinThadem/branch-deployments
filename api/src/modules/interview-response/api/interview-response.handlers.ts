import response from '../../../services/server/response'
import { AuthenticatedRequest } from '../../../types'
import { InterviewResponseEntity } from '../db/interview-response.entity'

export const getInterviewResponse = async (req: AuthenticatedRequest, res: Response) => {
	const responses = await InterviewResponseEntity.findOne({
		where: {
			id: req.params.interview_response_id,
		},
		relations: ['deliverables', 'contact'],
	})

	return response({ res, data: responses })
}

export const getNextAndPrevInterviewResponse = async (req: AuthenticatedRequest, res: Response) => {
	const id = req.params.interview_response_id
	const team_id = req.headers.team_id

	const nextRow = await InterviewResponseEntity.createQueryBuilder('entity')
		.select('entity.id', 'id')
		.where('entity.id > :id', { id })
		.andWhere('entity.team_id = :team_id', { team_id })
		.orderBy('entity.id', 'ASC')
		.getRawOne()

	// Find the previous row ID
	const previousRow = await InterviewResponseEntity.createQueryBuilder('entity')
		.select('entity.id', 'id')
		.where('entity.id < :id', { id: id })
		.andWhere('entity.team_id = :team_id', { team_id })
		.orderBy('entity.id', 'DESC')
		.getRawOne()

	return response({ res, data: {
		nextRowId: nextRow?.id,
		prevRowId: previousRow?.id,
	} })
}
