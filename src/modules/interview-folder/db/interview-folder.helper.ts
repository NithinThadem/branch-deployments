import { InterviewFolderEntity } from './interview-folder.entity'

export const getInterviewFolderNameById = async (id) => {
	const interviewFolder = await InterviewFolderEntity.find({
		select: ['name'],
		where: {
			id,
		},
	})

	return interviewFolder
}
