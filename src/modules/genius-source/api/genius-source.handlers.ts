import { addTextSourceToPinecone } from '../../genius/db/genius.helpers'
import { captureError } from '../../../util/error.util'
import response from '../../../services/server/response'
import { AuthenticatedRequest } from '../../../types'
import { GeniusSourceEntity } from '../db/genius-source.entity'
import analytics from '../../../services/segment'

export const getSource = async (req: AuthenticatedRequest, res: Response) => {
	const source = await GeniusSourceEntity.findOneOrFail({
		where: { id: req.params.source_id },
	})

	return response({ res, data: source })
}

export const editSource = async (req: AuthenticatedRequest, res: Response) => {
	try {
		const user = await req.auth.getUser()

		const sourceId = req.params.source_id
		const newContent = req.body.content

		const source = await GeniusSourceEntity.findOneOrFail({
			where: { id: sourceId },
		})

		source.content = newContent
		await source.save()

		await addTextSourceToPinecone(source)
		try {
			analytics.track({
				userId: user.id,
				event: 'Genius Source Edited',
				properties: {
					distinct_id: user?.email,
					source_id: sourceId,
					content_length: newContent.length,
					team_id: req.headers.team_id,
				},
			})
		} catch (error) {
			captureError(error)
		}

		return response({ res, data: { message: 'Genius content updated successfully.' } })
	} catch (error) {
		captureError(error)
		return response({ res, status: 500, error: 'Internal Server Error' })
	}
}
