import { Request, Response, NextFunction } from 'express'
import * as jwt from 'jsonwebtoken'
import { getOrCreateUser, getRawTeamsOfUser } from '../../../modules/user/db/user.helpers'
import { fetchUserRoles, getManagementApiToken } from '../auth0'
import { captureError } from '../../../util/error.util'
import logger from '../../../util/logger.util'
import { redisRead, redisWrite } from '../../redis'
import { isDevelopment, isProduction, isTesting } from '../../../util/env.util'
import { ApiTokenEntity } from '../../../modules/api-token/db/api-token.entity'
import { checkPathIsApiEligible } from '../openapi'
import { v4 } from 'uuid'

interface DecodedToken {
	// Define the properties you expect to find in the decoded token
	// For example, you might have properties like 'sub', 'iss', 'aud', etc.
	[key: string]: any;
}

export const authMiddleware = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const secret = process.env.AUTH0_SECRET
	const audience = process.env.AUTH0_AUDIENCE
	const issuerBaseURL = process.env.AUTH0_ISSUER_BASE_URL
	const tokenSigningAlg = process.env.AUTH0_TOKEN_SIGNING_ALG

	try {
		if (isTesting() && !isProduction()) {
			const email = req.headers['x-test-email'] as string

			if (!email) {
				throw new Error('No email provided for test request.')
			}

			req.auth = {
				roles: [],
				email: email,
				getUser: async (relations?: string[]) => getOrCreateUser(email, relations, req.headers.team_id),
			}

			return next()
		}

		// Get the token from the request headers

		const bearerToken = req.headers.authorization && req.headers.authorization.split(' ')[1]
		const apiToken = req.headers['x-api-token']

		if (bearerToken === 'dev-admin' && !isProduction()) {
			req.auth = {
				roles: ['admin'],
				getUser: async () => {
					const dummyUser = {
						id: v4(),
						name: 'John Doe',
					}
					return dummyUser
				},
			}
			return next()
		}

		if (apiToken) {
			if (!checkPathIsApiEligible(req.path)) {
				throw new Error('API token not allowed for this path.')
			}

			const token = await ApiTokenEntity.findOneOrFail({
				where: {
					token: apiToken,
				},
				relations: ['team', 'user'],
			})

			req.headers = {
				...req.headers,
				team_id: token.team.id,
			}

			req.auth = {
				tokenUser: {
					...token.user,
					team: token.team,
				},
				roles: [],
				email: token.user.email,
				getUser: async (relations?: string[]) => getOrCreateUser(token.user.email, relations, token.team.id),
			}

			return next()
		}

		if (!bearerToken) {
			throw new Error('No token provided.')
		}

		// Verify the token using jsonwebtoken package
		const verifyOptions: jwt.VerifyOptions = {
			audience: audience,
			issuer: issuerBaseURL,
			algorithms: [tokenSigningAlg as jwt.Algorithm],
		}

		// Verify the token and extract the decoded payload
		const decodedToken = jwt.verify(bearerToken, secret, verifyOptions) as DecodedToken

		// Extract any roles assigned to user
		const userId = decodedToken.sub
		const currentTime = new Date().getTime()
		let roles: string[]

		try {
			const cachedData = await redisRead(`roles_${userId}`)
			const cachedRoles = cachedData ? JSON.parse(cachedData) : null

			if (cachedRoles && (currentTime - cachedRoles.timestamp) < 30 * 60 * 1000) {
				roles = cachedRoles.roles
				logger.info('Using cached roles')
			} else {
				logger.info('Fetching user roles')

				const managementToken = await getManagementApiToken({
					clientId: process.env.AUTH0_MGMT_CLIENT_ID as string,
					clientSecret: process.env.AUTH0_MGMT_CLIENT_SECRET as string,
					audience: process.env.AUTH0_MGMT_AUDIENCE,
				})

				roles = await fetchUserRoles(userId, managementToken)

				await redisWrite(`roles_${userId}`, JSON.stringify({ roles, timestamp: currentTime }), { EX: 30 * 60 })
			}
		} catch (error) {
			logger.error('Error in auth middleware:', error)
			return res.status(500).send('Internal Server Error')
		}

		if (!decodedToken.email) {
			logger.debug(`No email found in token: ${JSON.stringify(decodedToken)}`)
			throw new Error('No email found in token.')
		}

		req.auth = {
			...decodedToken,
			roles,
			getUser: async (relations?: string[]) => {
				const user = await getOrCreateUser(decodedToken.email, relations)
				return user
			},
		}

		next()
	} catch (err) {
		res.status(401).json({ error: 'Unauthorized.' })
	}
}

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
	if (isDevelopment()) {
		return next()
	} else if (isProduction()) {
		const isAdmin = req.auth && req.auth.roles && req.auth.roles.includes('Admin')
		if (!isAdmin) {
			return res.status(403).json({ error: 'Forbidden: Admin role required' })
		}
		next()
	}
}

export const adminOrUserMiddleware = async (req, res, next) => {
	try {
		if (isTesting() && !isProduction()) {
			return next()
		}

		const isAdmin = req.auth.roles.includes('Admin')
		const user = await req.auth.getUser()
		const team_id = req.headers.team_id

		if (req.auth.tokenUser && req.auth.tokenUser.team) {
			return next()
		}

		const teams = await getRawTeamsOfUser(user?.id)

		if (isDevelopment() && req.headers.authorization === 'Bearer dev-admin') {
			return next()
		}

		if ((!user || !user.first_name || !user.last_name) || (teams && teams.length === 0)) {
			return
		}

		if (!isAdmin) {
			if (teams.map((team) => team.id).indexOf(team_id) === -1) {
				return res.status(403).json({ error: 'Forbidden: You do not have access to this team.' })
			}
		}
		next()
	} catch (error) {
		captureError(error)
		if (!res.headersSent) {
			res.status(500).send('Internal Server Error')
		}
	}
}

export const adminEditingMiddleware = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	if (isTesting() && !isProduction()) {
		return next()
	}

	const isAdmin = req.auth.roles.includes('Admin')
	const isAdminEditing = req.headers.is_admin_editing
	const team_id = req.headers.team_id

	if (req.auth.tokenUser && req.auth.tokenUser.team) {
		return next()
	}

	if (isDevelopment() && req.headers.authorization === 'Bearer dev-admin') {
		return next()
	}

	if (req.method === 'GET') {
		return next()
	}

	const user = await req.auth.getUser()
	const teams = await getRawTeamsOfUser(user?.id)

	const isOnTeam = teams.map((team) => team.id).includes(team_id)

	if (!isOnTeam) {
		if (isAdmin && isAdminEditing === 'false') {
			return res
				.status(403)
				.json({ error: 'Forbidden: Turn on admin editing mode to complete this action.' })
		}
	}

	next()
}

export const isImpersonatingMiddleware = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const isImpersonating = req.headers.is_impersonating
	const team_id = req.headers.team_id

	const user = await req.auth.getUser()
	const teams = await getRawTeamsOfUser(user?.id)
	const isOnTeam = teams.map((team) => team.id).includes(team_id)

	// allow in dev env
	if (isDevelopment() && req.headers.authorization === 'Bearer dev-admin') {
		return next()
	}

	// allow when user is not in impersonate mode or req.method is only GET
	if (isImpersonating === 'false' || req.method === 'GET' || isOnTeam) {
		return next()
	}

	return res.status(403).json({ error: 'Only GET requests are allowed in impersonating mode' })
}

export const teamOnlyMiddleware = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const user = await req.auth.getUser()
	const team_id = req.headers.team_id

	if (req.auth.tokenUser && req.auth.tokenUser.team) {
		return next()
	}

	if (isDevelopment() && req.headers.authorization === 'Bearer dev-admin') {
		return next()
	}

	const teams = await getRawTeamsOfUser(user?.id)

	if (teams.map((team) => team.id).includes(team_id)) {
		next()
	} else {
		return res.status(403).json({ error: 'Forbidden: Access restricted to team members only.' })
	}
}
