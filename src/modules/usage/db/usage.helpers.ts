import logger from '../../../util/logger.util'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { UsageEntity } from './usage.entity'
import { UsageType } from './usage.types'

export const saveUsageFromInterviewResponse = async (response: InterviewResponseEntity) => {
	logger.debug(`Saving usage for interview ${response.interview.id}`)

	const interview = await InterviewEntity.findOne({
		where: {
			id: response.interview.id,
		},
		relations: ['team'],
	})

	await UsageEntity.create({
		team: {
			id: interview.team_id,
		},
		interview: {
			id: interview.id,
		},
		type: UsageType.INTERVIEW,
		quantity_ms: response.duration_ms,
	}).save()
}

export const saveUsageForPreview = async (interview: InterviewEntity) => {
	logger.debug(`Saving usage for preview of interview ${interview.id}`)
	await UsageEntity.create({
		team: {
			id: interview.team_id,
		},
		interview: {
			id: interview.id,
		},
		type: UsageType.PREVIEW,
		quantity_ms: 1000 * 5, // 5 seconds
	}).save()
}
