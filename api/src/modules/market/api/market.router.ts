import { Router } from 'express'
import validator from '../../../services/server/middleware/validator.middleware'
import marketSchema from './market.schema'
import { RequestPart } from '../../../types'
import {
	buyMarketListing, createMarketListing, getAllMarketListings, getMarketListing, updateMarketListing,
} from './market.handlers'
import { auditMiddleware } from '../../../services/server/middleware/audit-log.middleware'

export const marketRouter = Router()
const logDetails = {
	getAllMarketListings: {
		method: 'GET',
		reason: 'Request to get all markets',
		resource: 'market',
	},
	getMarketListing: {
		method: 'GET',
		reason: 'Request get market by id',
		resource: 'market',
	},
	updateMarketListing: {
		method: 'UPDATE',
		reason: 'Request to update market',
		resource: 'market',
	},
	buyMarketListing: {
		method: 'POST',
		reason: 'Request to buy market by id',
		resource: 'market',
	},
	createMarketListing: {
		method: 'POST',
		reason: 'Request ot create market',
		resource: 'market',
	},
}

marketRouter.get(
	'/',
	validator(marketSchema.getAll, RequestPart.QUERY),
	auditMiddleware(logDetails.getAllMarketListings),
	getAllMarketListings,
)

marketRouter.get(
	'/:market_id',
	validator(marketSchema.id, RequestPart.PARAMS),
	auditMiddleware(logDetails.getMarketListing),
	getMarketListing,
)

marketRouter.put(
	'/:market_id',
	validator(marketSchema.id, RequestPart.PARAMS),
	validator(marketSchema.update, RequestPart.BODY),
	auditMiddleware(logDetails.updateMarketListing),
	updateMarketListing,
)

marketRouter.post(
	'/:market_id/buy',
	validator(marketSchema.id, RequestPart.PARAMS),
	validator(marketSchema.buy, RequestPart.BODY),
	auditMiddleware(logDetails.buyMarketListing),
	buyMarketListing,
)

marketRouter.post(
	'/create',
	validator(marketSchema.create, RequestPart.BODY),
	auditMiddleware(logDetails.createMarketListing),
	createMarketListing,
)

