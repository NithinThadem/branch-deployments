import { InterviewEntity } from './interview.entity'

export const getInterviewNameById = async (id) => {
	const interview = await InterviewEntity.find({
		select: ['title'],
		where: {
			id,
		},
	})

	return interview
}
