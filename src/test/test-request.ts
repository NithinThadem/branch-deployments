import * as supertest from 'supertest'

const URL = process.env.TEST_API_URL
const TOKEN = process.env.SECRET_TOKEN

const hook = (method: 'get' | 'post' | 'put' | 'delete' | 'patch') => (url: string) =>
	supertest(URL)[method](url)
		.set('Authorization', `Bearer ${TOKEN}`)
		.set('x-test-email', process.env.TEST_USER_EMAIL)
		.set('team_id', process.env.TEST_TEAM_ID)

const testRequest = {
	get: hook('get'),
	post: hook('post'),
	put: hook('put'),
	delete: hook('delete'),
	patch: hook('patch'),
}

export default testRequest
