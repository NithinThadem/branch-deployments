import { OAuth2Client, TokenPayload } from 'google-auth-library'

const getClient = () => new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID)

export const getOauthTokenPayload = async (credential: string): Promise<TokenPayload> => {
	const ticket = await getClient().verifyIdToken({
		idToken: credential,
		audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
	})
	return ticket.getPayload()
}
