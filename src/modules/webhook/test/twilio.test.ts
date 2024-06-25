import 'jest'
import testRequest from '../../../test/test-request'
import { faker } from '@faker-js/faker'

describe('Twilio business verification', () => {
	it('should return 200 and the expected response', async () => {
		const fakeData = {
			name: `TEST ${faker.company.name()}`,
			type: 'Corporation',
			industry: 'ONLINE',
			registration_id_type: 'EIN',
			registration_number: '12-3456789',
			regions_of_operation: 'USA_AND_CANADA',
			website_url: faker.internet.url(),
			address: {
				line_1: faker.location.streetAddress(),
				line_2: faker.location.secondaryAddress(),
				city: faker.location.city(),
				state: faker.location.state(),
				postal_code: faker.location.zipCode(),
				country: faker.location.country(),
			},
			authorized_signatory: {
				title: 'CEO',
				first_name: faker.person.firstName(),
				last_name: faker.person.lastName(),
			},
			company_type: 'private',
			stock_exchange: faker.lorem.word(),
			stock_ticker: '',
			campaign_data: {
				description: faker.lorem.paragraph(),
				message_flow: faker.lorem.paragraph(),
				usecase: 'LOW_VOLUME',
				message_samples: [faker.lorem.sentence(), faker.lorem.sentence()],
				has_embedded_links: true,
				has_embedded_phone: true,
				opt_in_message: '',
				opt_out_message: '',
				help_message: '',
				opt_in_keywords: [],
				opt_out_keywords: [],
				help_keywords: [],
			},
		}

		// 1. Submit business verification

		const { body: { data } } = await testRequest
			.post('/team/submit_business_metadata')
			.send(fakeData)
			.expect('Content-Type', /json/)
			.expect(200)

		expect(data.account_sid).not.toBeUndefined()
		expect(data.bundle_sid).not.toBeUndefined()

		// 2. Send customer profile in-review webhook

		await testRequest
			.post('/webhook/twilio/customer_profile')
			.send({
				AccountSid: data.account_sid,
				BundleSid: data.bundle_sid,
				Status: 'in-review',
			})
			.expect(200)

		// 3. Send customer profile approved webhook

		await testRequest
			.post('/webhook/twilio/customer_profile')
			.send({
				AccountSid: data.account_sid,
				BundleSid: data.bundle_sid,
				Status: 'twilio-approved',
			})
			.expect(200)

		// 4. Approved A2P brand

		await testRequest
			.post('/webhook/twilio/customer_a2p_bundle')
			.send({
				AccountSid: data.account_sid,
				BundleSid: data.bundle_sid,
				Status: 'twilio-approved',
			})
			.expect(200)

		// 5. Shaken Stir approved

		await testRequest
			.post('/webhook/twilio/shaken_stir')
			.send({
				AccountSid: data.account_sid,
				BundleSid: data.bundle_sid,
				Status: 'twilio-approved',
			})
			.expect(200)
	}, 60 * 1000)
})
