import { ILike } from 'typeorm'
import response from '../../../services/server/response'
import { AuthenticatedRequest } from '../../../types'
import { GeniusSourceEntity } from '../../genius-source/db/genius-source.entity'
import { GeniusEntity } from '../db/genius.entity'
import { GeniusSourceType } from '../../genius-source/db/genius-source.types'
import { Pinecone } from '../../../services/pinecone'
import { deleteSourcesFromNamespace } from '../db/genius.helpers'
import EventUtil from '../../../services/event'
import { deleteFile } from '../../../services/google/storage'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import analytics from '../../../services/segment'

export const getGeniusDatabases = async (req: AuthenticatedRequest, res: Response) => {
	const data = await GeniusEntity.createQueryBuilder('genius')
		.select('genius.id', 'id')
		.leftJoin('genius.sources', 'source')
		.leftJoin('genius.interviews', 'interviews')
		.addSelect('genius.name', 'name')
		.addSelect('COUNT(source.id)', 'source_count')
		.addSelect('COUNT(DISTINCT interviews.id)', 'used_by')
		.where('genius.team_id = :teamId', { teamId: req.headers.team_id })
		.groupBy('genius.id')
		.orderBy('genius.created', 'DESC')
		.getRawMany()

	return response({ res, data })
}

export const createGeniusDatabase = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	logger.info(`Creating new database for team ${req.headers.team_id}`)

	const data = await GeniusEntity.create({
		name: req.body.name,
		team_id: req.headers.team_id,
	}).save()

	const namespaceName = `genius-${data.id}`

	const pinecone = Pinecone()
	const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX as string).namespace(namespaceName)

	const dummyVector = new Array(1536).fill(0)

	await pineconeIndex.upsert([{
		id: 'dummy-id',
		values: dummyVector,
	}])
	try {
		analytics.track({
			userId: user.id,
			event: 'Genius Database Created',
			properties: {
				distinct_id: user.email,
				genius_database_id: data.id,
				team_id: req.headers.team_id,
				database_name: req.body.name,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data })
}

export const getGeniusDataSources = async (req: AuthenticatedRequest, res: Response) => {
	const limit = req.query.limit || 25

	const queryBuilder = GeniusSourceEntity.createQueryBuilder('source')
		.where('source.genius.id = :geniusId', { geniusId: req.params.id })
		.orderBy('source.created', 'DESC')
		.take(limit)

	if (req.query.search) {
		queryBuilder.andWhere([
			{ name: ILike(`%${req.query.search}%`) },
			{ content: ILike(`%${req.query.search}%`) },
		])
	}

	if (req.query.page) {
		queryBuilder.skip(limit * req.query.page)
	}

	const [sources, count] = await queryBuilder.getManyAndCount()

	return response({
		res,
		data: {
			sources,
			count,
		},
	})
}

export const updateGeniusDatabase = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const genius = await GeniusEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})
	genius.name = req.body.name

	await genius.save()

	try {
		analytics.track({
			userId: user.id,
			event: 'Genius Database Updated',
			properties: {
				distinct_id: user.email,
				name: req.body.name,
				genius_database_id: genius.id,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: genius })
}

export const deleteGeniusDataSources = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const deletedSources = []

	await Promise.all(
		req.body.source_ids.map(async (sourceId) => {
			try {
				const source = await GeniusSourceEntity.findOneOrFail({
					where: {
						id: sourceId,
						genius_id: req.params.id,
					},
				})

				if (source.file_url) {
					await deleteFile(source.file_url)
				}

				await deleteSourcesFromNamespace(source)

				await source.remove()
				deletedSources.push(source.id)
				try {
					analytics.track({
						userId: user.id,
						event: 'Genius Source Deleted',
						properties: {
							distinct_id: user.email,
							genius_source_id: source.id,
							genius_database_id: req.params.id,
							team_id: req.headers.team_id,
						},
					})
				} catch (error) {
					captureError(error)
				}
			} catch (error) {
				captureError(error)
			}
		})
	)

	return response({ res, data: deletedSources })
}

export const uploadTextSource = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const genius = await GeniusEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})

	const source = await GeniusSourceEntity.create({
		name: req.body.name,
		type: GeniusSourceType.TEXT,
		content: req.body.content,
		genius,
	}).save()

	await EventUtil.asyncEmit('GENIUS_UPLOAD_TEXT', { genius_source_id: source.id })

	try {
		analytics.track({
			userId: user.id,
			event: 'Genius Source Uploaded',
			properties: {
				distinct_id: user.email,
				genius_source_id: source.id,
				genius_database_id: genius.id,
				source_name: req.body.name,
				source_type: GeniusSourceType.TEXT,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: source })
}

export const deleteGeniusDatabase = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const genius = await GeniusEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})

	await EventUtil.asyncEmit('GENIUS_DELETE_DATABASE', { genius_id: genius.id })

	try {
		analytics.track({
			userId: user.id,
			event: 'Genius Database Deleted',
			properties: {
				distinct_id: user.email,
				genius_database_id: genius.id,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res })
}

export const uploadFileSource = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()
	const genius = await GeniusEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: user.team_id,
		},
	})

	const files = req.files
	const names = req.body.names

	const sources = await Promise.all(files.map(async (file: { url: any }, index: string | number) => {
		const name = names[index]
		const source = await GeniusSourceEntity.create({
			name: name,
			type: req.body.type,
			file_url: file.url,
			genius,
		}).save()

		switch (req.body.type) {
			case GeniusSourceType.AUDIO:
				await EventUtil.asyncEmit('GENIUS_UPLOAD_AUDIO', { genius_source_id: source.id })
				try {
					analytics.track({
						userId: user.id,
						event: 'Genius Source Uploaded',
						properties: {
							distinct_id: user.email,
							genius_source_id: source.id,
							genius_database_id: genius.id,
							source_name: name,
							source_type: GeniusSourceType.AUDIO,
							file_url: file.url,
							team_id: req.headers.team_id,
						},
					})
				} catch (error) {
					captureError(error)
				}

				break
			case GeniusSourceType.CSV:
				await EventUtil.asyncEmit('GENIUS_UPLOAD_FILE', { genius_source_id: source.id })

				try {
					analytics.track({
						userId: user.id,
						event: 'Genius Source Uploaded',
						properties: {
							distinct_id: user.email,
							genius_source_id: source.id,
							genius_database_id: genius.id,
							source_name: name,
							source_type: GeniusSourceType.CSV,
							file_url: file.url,
							team_id: req.headers.team_id,
						},
					})
				} catch (error) {
					captureError(error)
				}

				break
			case GeniusSourceType.PDF:
				await EventUtil.asyncEmit('GENIUS_UPLOAD_FILE', { genius_source_id: source.id })

				try {
					analytics.track({
						userId: user.id,
						event: 'Genius Source Uploaded',
						properties: {
							distinct_id: user.email,
							genius_source_id: source.id,
							genius_database_id: genius.id,
							source_name: name,
							source_type: GeniusSourceType.PDF,
							file_url: file.url,
							team_id: req.headers.team_id,
						},
					})
				} catch (error) {
					captureError(error)
				}

				break
		}
	}))

	return response({ res, data: sources })
}

export const uploadUrlSource = async (req: AuthenticatedRequest, res: Response) => {
	const user = await req.auth.getUser()

	const genius = await GeniusEntity.findOneOrFail({
		where: {
			id: req.params.id,
			team_id: req.headers.team_id,
		},
	})

	const source = await GeniusSourceEntity.create({
		name: req.body.name,
		type: GeniusSourceType.URL,
		url: req.body.url,
		genius,
	}).save()

	await EventUtil.asyncEmit('GENIUS_UPLOAD_URL', { genius_source_id: source.id })

	try {
		analytics.track({
			userId: user.id,
			event: 'Genius Source Uploaded',
			properties: {
				distinct_id: user.email,
				genius_source_id: source.id,
				genius_database_id: genius.id,
				source_name: req.body.name,
				source_type: GeniusSourceType.URL,
				team_id: req.headers.team_id,
			},
		})
	} catch (error) {
		captureError(error)
	}

	return response({ res, data: source })
}
