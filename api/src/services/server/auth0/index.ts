import axios from 'axios'
import { redisRead, redisWrite } from '../../redis'
import logger from '../../../util/logger.util'
import { captureError } from '../../../util/error.util'

interface ManagementClientConfig {
	clientId: string;
	clientSecret: string;
	audience: string;
}

export const getManagementApiToken = async (config: ManagementClientConfig): Promise<string> => {
	const tokenCacheKey = `auth0:token:${config.clientId}`
	try {
		const cachedToken = await redisRead(tokenCacheKey)
		if (cachedToken) {
			logger.debug('Using cached token')
			return cachedToken
		}

		const tokenUrl = process.env.AUTH0_TOKEN_URL
		const payload = {
			grant_type: 'client_credentials',
			client_id: config.clientId,
			client_secret: config.clientSecret,
			audience: config.audience,
		}

		const response = await axios.post(tokenUrl, payload, {
			headers: {
				'Content-Type': 'application/json',
			},
		})
		logger.info('caching token')
		const accessToken = response.data.access_token
		const expiresIn = response.data.expires_in || 3600
		await redisWrite(tokenCacheKey, accessToken, { EX: expiresIn - 60 })

		return accessToken
	} catch (error) {
		captureError(error)
		throw new Error('Could not obtain management API token')
	}
}

export const fetchUserRoles = async (userId: string, token: string) => {
	try {
		const url = `${process.env.AUTH0_ISSUER_BASE_URL}api/v2/users/${userId}/roles`
		const response = await axios.get(url, {
			headers: { Authorization: `Bearer ${token}` },
		})
		return response.data.map((role: any) => role.name)
	} catch (error) {
		logger.error('Error fetching user roles', error)
		return []
	}
}
