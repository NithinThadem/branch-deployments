import 'jest'
import testRequest from '../../test/test-request'

describe('User endpoints', () => {
	it('should get the correct user', async () => {
		const response = await testRequest
			.get('/user')
			.expect('Content-Type', /json/)
			.expect(200)

		expect(response.body.data.email).toEqual(process.env.TEST_USER_EMAIL)
	})
})
