import response from '../../../services/server/response'
import dataSource from '../../../services/database/data-source'
import { AuthenticatedRequest } from '../../../types'
import { MarketEntity } from '../db/market.entity'
import { InterviewResponseEntity } from '../../../modules/interview-response/db/interview-response.entity'
import { InterviewEntity } from '../../../modules/interview/db/interview.entity'

export const getAllMarketListings = async (req: AuthenticatedRequest, res: Response) => {
	const searchText = req.query.search || ''
	const sort = req.query.sort || 'created_desc'
	const resultsPerPage = req.query.limit || 25
	const page = req.query.page || 0

	let orderByField = 'market.created'
	let orderByDirection: 'ASC' | 'DESC' = 'DESC'

	switch (sort) {
		case 'name_asc':
			orderByField = 'market.listing_name'
			orderByDirection = 'ASC'
			break
		case 'name_desc':
			orderByField = 'market.listing_name'
			orderByDirection = 'DESC'
			break
		case 'created_asc':
			orderByField = 'market.created'
			orderByDirection = 'ASC'
			break
		case 'created_desc':
			orderByField = 'market.created'
			orderByDirection = 'DESC'
			break
		default:
			orderByField = 'market.created'
			orderByDirection = 'DESC'
			break
	}

	const count = await dataSource
		.createQueryBuilder(MarketEntity, 'market')
		.where('market.listing_name ILike :searchText', ({ searchText: `%${searchText}%` }))
		.getCount()

	const { entities } = await dataSource
		.createQueryBuilder(MarketEntity, 'market')
		.where('market.listing_name ILike :searchText', ({ searchText: `%${searchText}%` }))
		.groupBy('market.id')
		.orderBy(orderByField, orderByDirection)
		.take(resultsPerPage)
		.skip(page * resultsPerPage)
		.getRawAndEntities()

	return response({
		res,
		data: {
			market: entities,
			count,
		},
	})
}

export const getMarketListing = async (req: AuthenticatedRequest, res: Response) => {
	const marketListing = await MarketEntity.findOneOrFail({
		where: {
			id: req.params.market_id,
		},
	})

	return response({ res, data: marketListing.toPublic() })
}

export const createMarketListing = async (req: AuthenticatedRequest, res: Response) => {
	const description = req.body.description
	const tags = req.body.tags
	const listingName = req.body.listing_name
	const price = 0
	const imageUrl = req.body.image_url
	const interviewId = req.body.interview_id

	const marketListing = await MarketEntity.create({
		description,
		listing_name: listingName,
		price,
		tags,
		image_url: imageUrl,
		interview: interviewId,
	})

	if (req.body.interview_response_id) {
		const interviewResponse = await InterviewResponseEntity.findOne({
			where: {
				id: req.body.interview_response_id,
			},
		})

		if (interviewResponse) {
			marketListing.demo_url = interviewResponse.recording_url
		}
	}

	await marketListing.save()

	return response({ res, data: marketListing.toPublic() })
}

export const updateMarketListing = async (req: AuthenticatedRequest, res: Response) => {
	const marketListing = await MarketEntity.findOneOrFail({
		where: {
			id: req.params.market_id,
		},
	})

	if (req.body.listing_name) {
		marketListing.listing_name = req.body.listing_name
	}

	if (req.body.description) {
		marketListing.description = req.body.description
	}

	if (req.body.price) {
		marketListing.price = req.body.price
	}

	if (req.body.tags) {
		marketListing.tags = req.body.tags
	}

	if (req.body.image_url) {
		marketListing.image_url = req.body.image_url
	}

	if (req.body.interview_response_id) {
		const interviewResponse = await InterviewResponseEntity.findOne({
			where: {
				id: req.body.interview_response_id,
			},
		})

		if (!interviewResponse) {
			throw new Error('Corresponding interview_response can not be found.')
		}

		marketListing.demo_url = interviewResponse.recording_url
	}

	await marketListing.save()

	return response({ res, data: marketListing.toPublic() })
}

export const buyMarketListing = async (req: AuthenticatedRequest, res: Response) => {
	const team_id = req.headers.team_id
	const should_include_genius = req.body.should_include_genius

	const marketListing = await MarketEntity.findOneOrFail({
		where: {
			id: req.params.market_id,
		},
		relations: ['interview'],
	})

	const foundInterview = marketListing.interview

	const newInterview = await InterviewEntity.create({
		flow: foundInterview.flow,
		lang: foundInterview.lang,
		note_to_subject: foundInterview.note_to_subject,
		title: foundInterview.title,
		personality_customization: foundInterview.personality_customization,
		presence_background_audio: foundInterview.presence_background_audio,
		presence_interim_audio: foundInterview.presence_interim_audio,
		type: foundInterview.type,
		ai_name: foundInterview.ai_name,
		team_id,
	})

	if (should_include_genius) {
		newInterview.genius_id = foundInterview.genius_id
	}

	await newInterview.save()

	return response({ res, data: newInterview.toPublic() })
}
