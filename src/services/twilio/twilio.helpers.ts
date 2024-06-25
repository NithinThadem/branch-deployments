/* eslint-disable max-len */
import { masterTwilioClient, twilioClient } from '.'
import { TeamEntity } from '../../modules/team/db/team.entity'
import { withExponentialBackoff } from '../../util/helpers.util'
import logger from '../../util/logger.util'
import { getTeamUserEmails } from '../../modules/team/api/team.helpers'
import { sendTransactionalEmail } from '../email'
import { TransactionalEmail } from '../email/emails.enums'
import { captureError } from '../../util/error.util'
import * as _ from 'lodash'
import { PhoneNumberEntity } from '../../modules/phone_number/db/phone_number.entity'
import { A2P_BRAND_STATUS } from '../../modules/team/db/team.types'
import { InterviewEntity } from '../../modules/interview/db/interview.entity'

export const createTwilioSubaccountForTeam = async (team: Partial<TeamEntity>): Promise<{
	sid: string
	secret: string
}> => {
	const { sid, authToken } = await withExponentialBackoff(async () => await masterTwilioClient().api.accounts.create({
		friendlyName: team.name,
	}))

	return { sid, secret: authToken }
}

export const createTwilioCustomerProfileForTeam = async (team: Partial<TeamEntity>, email: string, accountSid?: string) => {
	const account_sid = team.twilio_account_sid || accountSid

	if (!account_sid) {
		throw new Error('Twilio account SID not found when creating customer profile for team')
	}

	const { sid } = await withExponentialBackoff(async () => twilioClient(account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles.create({
		statusCallback: `https://${process.env.API_URL}/webhook/twilio/customer_profile`,
		friendlyName: team.id,
		email: email,
		policySid: 'RNdfbf3fae0e1107f8aded0e7cead80bf5',
	}))

	logger.info(`Created Twilio customer profile ${sid} for team ${team.name}, user: ${email}`)

	return sid
}

export const updateTwilioSubaccountName = async (team: TeamEntity, name: string) =>
	withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).api.accounts(team.twilio_account_sid).update({
		friendlyName: name,
	}))

export const updateTwilioCustomerProfileStatusForTeam = async (team: TeamEntity) => {
	const twilioCustomerProfile = await withExponentialBackoff(async () =>
		await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid).fetch())

	team.twilio_metadata.twilio_customer_profile_status = twilioCustomerProfile.status

	logger.debug(`Updated Twilio account status for team ${team.name} to ${twilioCustomerProfile.status}`)

	await team.save()
	return twilioCustomerProfile.status
}

export const resetTwilioEvaluation = async (team: TeamEntity) => {
	try {
		logger.info(`Resetting Twilio TrustHub evaluation for team ${team.name}`)

		// Remove all assignments

		const assignments = await withExponentialBackoff(async () =>
			await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
				.customerProfilesEntityAssignments
				.list())

		await Promise.all(assignments.map(async ({ sid }) => {
			try {
				await withExponentialBackoff(async () =>
					await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
						.customerProfilesEntityAssignments(sid)
						.remove())

				await Promise.all([
					await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers(sid).remove()
						.catch(() => {
							// no-op
						})),

					await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).addresses(sid).remove()
						.catch(() => {
							// no-op
						})),

					await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.supportingDocuments(sid).remove()
						.catch(() => {
							// no-op
						})),
				])
			} catch (error) {
				logger.warn(`Failed to remove Twilio TrustHub entity assignment ${sid}: ${error.message}`)
			}
		}))
	} catch (error) {
		logger.warn(`Failed to list entity assignments for customer profile ${team.twilio_metadata.twilio_customer_profile_sid}: ${error.message}`)
	}

	// Remove addresses

	await withExponentialBackoff(async () =>
		await twilioClient(team.twilio_account_sid, team.twilio_account_secret).addresses.list()
			.then((addresses) => Promise.all(addresses.map(async ({ sid }) => {
				await twilioClient(team.twilio_account_sid, team.twilio_account_secret).addresses(sid).remove()
					.catch(() => {
						// no-op
					})
			})))
			.catch(() => {
				// no-op
				logger.warn(`Failed to list addresses for team ${team.name}`)
			}))
}

export const submitShakenStir = async (team: TeamEntity) => {
	// connect all phone numbers to secondary business
	/* this is for shaken/stir, check: https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir/shakenstir-onboarding/shaken-stir-trust-hub-api-isvs-single-project#add-phone-number-to-secondary-business-profile */
	await Promise.all(team.phone_numbers.map(async (phone) => {
		try {
			await withExponentialBackoff(async () =>
				await twilioClient(team.twilio_account_sid, team.twilio_account_secret).incomingPhoneNumbers(phone.twilio_sid).update({
					addressSid: team.business_metadata.address_sid,
					bundleSid: team.twilio_metadata.twilio_customer_profile_sid,
				}))

			await twilioConnectPhoneNumberToCustomerProfile({
				phoneNumberSid: phone.twilio_sid,
				secondaryBusinessProfileSid: team.twilio_metadata.twilio_customer_profile_sid,
				team,
			})

			logger.debug(`Connected Twilio phone number to secondary business, phone sid: ${phone.twilio_sid}`)
		} catch (error) {
			logger.debug(`Phone number (sid ${phone.twilio_sid}) is already connected to the account. Trying other numbers...`)
		}
	}))

	/* submit shaken/stir */

	try {
		logger.info('Creating Shaken Stir trust product.')
		const { sid: trustProductSid } = await twilioCreateShakenStirTrustProduct({
			email: 'support@thought.ly',
			friendlyName: `shakenstir-for-${team.name}`,
			team,
		})

		logger.info('Connecting shaken stir product to customer profile')
		await twilioConnectShakenStirTrustProduct({
			secondaryBusinessProfileSid: team.twilio_metadata.twilio_customer_profile_sid,
			trustProductSid,
			team,
		})

		logger.info('Connecting phone numbers to shaken stir product')
		for (const phone of team.phone_numbers) {
			await twilioAssignPhoneNumberToShakenStirProduct({
				phoneNumberSid: phone.twilio_sid,
				trustProductSid,
				team,
			})
		}

		logger.info(`Submitting shaken stir for bundle ${trustProductSid}: team ${team.name}`)
		const { status } = await twilioSubmitShakenStir({
			trustProductSid,
			team,
		})

		team.twilio_metadata.twilio_customer_shaken_stir_sid = trustProductSid
		team.twilio_metadata.twilio_shaken_stir_status = status
		await team.save()

		logger.debug(`Submitted Twilio Shaken/Stir for review for team ${team.name}, status: ${status}`)
	} catch (error) {
		captureError(error)
	}
}

export const onTwilioCustomerProfileApproved = async (team: TeamEntity) => {
	logger.info(`Twilio customer profile evaluation approved for team ${team.name}`)

	try {
		const teamMemberEmails = await getTeamUserEmails(team.id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email: email,
				type: TransactionalEmail.BUSINESS_VERIFICATION_APPROVED,
				data: {
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const assignPhoneNumberToCnam = async (team: TeamEntity, phoneNumber: PhoneNumberEntity) => {
	await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(team.twilio_metadata.twilio_customer_cnam_trust_product_sid)
		.trustProductsChannelEndpointAssignment.create({
			channelEndpointType: 'phone-number',
			channelEndpointSid: phoneNumber.twilio_sid,
		})
}

export const onTwilioCustomerProfileRejected = async (team: TeamEntity, failure_reason: string) => {
	try {
		const teamMemberEmails = await getTeamUserEmails(team.id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email: email,
				type: TransactionalEmail.BUSINESS_VERIFICATION_REJECTED,
				data: {
					failure_reason,
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const onTwilioCustomerA2PBrandApproved = async (team: TeamEntity) => {
	logger.info(`Twilio A2P Brand evaluation approved for team ${team.name}`)

	try {
		const friendlyName = `msg-service-for-${_.kebabCase(team.name)}`

		// create a messaging service
		const messagingServiceSid = await twilioCreateMessagingService({ friendlyName, team })

		team.twilio_metadata.twilio_customer_messaging_service_sid = messagingServiceSid
		await team.save()

		logger.info(`Created Messaging Service for team ${team.name}`)
	} catch (error) {
		captureError(error)
	}
}

export const onTwilioCustomerA2PCampaignApproved = async (team: TeamEntity) => {
	logger.info(`Twilio A2P Campaign evaluation approved for team ${team.name}`)

	const teamMemberEmails = await getTeamUserEmails(team.id)

	// connect all phone numbers to messaging service that connected to the campaign
	logger.info(`connecting phone numbers to messaging service ${team.twilio_metadata.twilio_customer_messaging_service_sid}`)

	for (const phone of team.phone_numbers) {
		try {
			await twilioConnectPhoneToMessagingService({
				messagingServiceSid: team.twilio_metadata.twilio_customer_messaging_service_sid,
				phoneNumberSid: phone.twilio_sid,
				team,
			})
		} catch (error) {
			logger.debug(`Error while connecting a phone to messaging service, if it is already connected you can ignore the error: ${error}`)
		}
	}

	try {
		// send email to all team members
		logger.info(`sending campaign approved emails to team ${team.name}`)
		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email,
				type: TransactionalEmail.CAMPAIGN_APPROVED,
				data: {
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const onTwilioCustomerA2PCampaignRejected = async (team: TeamEntity, errors: string[]) => {
	logger.info(`Twilio A2P Campaign evaluation rejected for team ${team.name}`)

	try {
		const teamMemberEmails = await getTeamUserEmails(team.id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email,
				type: TransactionalEmail.CAMPAIGN_REJECTED,
				data: {
					failure_reason: errors[0],
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const twilioCreateA2PTrustBundle = async ({
	friendlyName,
	email,
	policySid,
	team,
}: {
	friendlyName: string,
	email: string,
	policySid: string,
	team: TeamEntity
}) => {
	/* try {
		const list = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts
			.list())

		const bundle = list.find(el => el.friendlyName === friendlyName)

		logger.info(`Found already created bundle, returning... ${bundle.sid}`)
		if (bundle) {
			return bundle.sid
		}
	} catch (error) {
		logger.error(`Unable to get list of bundle for team: ${team.name}, ${error}`)
	} */

	const { sid: trustProductSid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts
		.create({
			friendlyName,
			email,
			policySid,
		}))

	return trustProductSid
}

export const twilioCreateA2PEndUser = async ({
	friendlyName,
	attributes,
	team,
}: {
	friendlyName: string,
	attributes: any
	team: TeamEntity
}) => {
	/* return the a2p user if exists */
	try {
		const list = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers
			.list())

		const endUser = list.find(user => user.friendlyName === friendlyName && user.type === 'us_a2p_messaging_profile_information')

		logger.info(`Found already created end user, returning... ${endUser.sid}`)
		if (endUser) {
			return endUser.sid
		}
	} catch (error) {
		logger.error(`Error listing a2p end users for team: ${team.name}, if there are no end users created before you can ignore the error.`)
	}

	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers
		.create({
			attributes,
			friendlyName,
			type: 'us_a2p_messaging_profile_information',
		}))

	return sid
}

export const twilioAssignEndUserToTrustBundle = async ({
	trustProductSid,
	objectSid,
	team,
}: {
	trustProductSid: string,
	objectSid: string,
	team: TeamEntity
}) => {
	try {
		const assignments = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1
			.trustProducts(trustProductSid)
			.trustProductsEntityAssignments
			.list())

		const assignedItem = assignments.find(a => a.objectSid === objectSid)
		if (assignedItem) {
			/* the item is already assigned, no need to assign again */
			logger.info(`Object sid: ${objectSid} is already assigned to trust product: ${trustProductSid} returning...`)
			return
		}
	} catch (error) {
		logger.debug(`Error trying to list assignments for trust product: ${trustProductSid} . If the trust product newly created you can ignore the error.`)
	}

	await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1
		.trustProducts(trustProductSid)
		.trustProductsEntityAssignments
		.create({
			objectSid,
		}))
}

export const twilioRunEvaluationsOnTrustProduct = async ({
	trustProductSid,
	policySid,
	team,
}: {
	trustProductSid: string,
	policySid: string,
	team: TeamEntity
}) => {
	const { status, results } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1
		.trustProducts(trustProductSid)
		.trustProductsEvaluations
		.create({
			policySid,
		}))

	return { status, results }
}

export const twilioSubmitTrustBundle = async ({
	trustProductSid,
	team,
}: {
	trustProductSid: string
	team: TeamEntity
}) => {
	const { sid, status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1
		.trustProducts(trustProductSid)
		.update({
			status: 'pending-review',
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/customer_a2p_bundle`,
		}))

	team.twilio_metadata.twilio_customer_a2p_bundle_status = status
	await team.save()

	return sid
}

export const twilioCreateA2PBrand = async ({
	team,
	a2PProfileBundleSid,
	customerProfileBundleSid,
	isMock,
}: {
	team: TeamEntity
	a2PProfileBundleSid: string,
	customerProfileBundleSid: string,
	isMock?: boolean
}) => {
	const list = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.brandRegistrations
		.list())

	const brand = list.find(b => b.customerProfileBundleSid === team.twilio_metadata.twilio_customer_profile_sid)

	/* if brand is found, it means that user is submitting the brand again, so just update it to get reviewed one more time */
	/* check: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-standardlvs-brands#updating-an-a2p-brand-using-the-api */

	/* only update when brand is in FAILED state! */
	/* https://thoughtly.sentry.io/issues/5514473693/events/68a6e9e9cfb94a3f9549c755f6ed1580/?project=4505699564126208 */
	if (brand && brand.status === 'FAILED') {
		await brand.update()

		/* ensure that brand sid is saved in database */
		team.twilio_metadata.twilio_customer_brand_registration_sid = brand.sid
		team.twilio_metadata.twilio_customer_a2p_brand_status = A2P_BRAND_STATUS.PENDING
		await team.save()

		return brand.sid
	} else {
		/* user is submitting the brand first time */
		const { sid: brandRegistrationSid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
			.brandRegistrations
			.create({
				skipAutomaticSecVet: true,
				customerProfileBundleSid,
				a2PProfileBundleSid,
				mock: isMock || false,
			}))

		/* ensure that brand sid is saved in database */
		team.twilio_metadata.twilio_customer_brand_registration_sid = brandRegistrationSid
		team.twilio_metadata.twilio_customer_a2p_brand_status = A2P_BRAND_STATUS.PENDING
		await team.save()

		return brandRegistrationSid
	}
}

export const twilioGetBrands = async (team: TeamEntity) => {
	const list = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.brandRegistrations
		.list())

	return list
}

export const twilioCreateMessagingService = async ({
	friendlyName,
	team,
}: {
	friendlyName: string,
	team: TeamEntity
}) => {
	const { sid: messagingServiceSid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1.services
		.create({
			friendlyName,
			inboundRequestUrl: `https://${process.env.API_URL}/webhook/twilio/sms`,
		}))

	return messagingServiceSid
}

export const twilioCreateWebhookSink = async (team: TeamEntity) => {
	const list = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).events.v1.sinks
		.list())

	const sink = list.find(val => val.description === `A2P Sink for team ${team.name}`)

	// dont create a new sink if it is already created!
	if (sink && (sink.status === 'active' || sink.status === 'initialized')) {
		return sink.status
	}

	const { sid, status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).events.v1.sinks
		.create({
			description: `A2P Sink for team ${team.name}`,
			sinkConfiguration: {
				destination: `https://${process.env.API_URL}/webhook/twilio/sink_handler`,
				method: 'POST',
				batch_events: false,
			},
			sinkType: 'webhook',
		}))

	if (status === 'initialized' || status === 'active') {
		await twilioCreateSinkSubscription({
			sinkSid: sid,
			team,
		})
	}

	return status
}

export const twilioCreateSinkSubscription = async ({
	sinkSid,
	team,
}: {
	sinkSid: string
	team: TeamEntity
}) => {
	const res = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).events.v1.subscriptions
		.create({
			description: 'A2P Sink Subscription',
			sinkSid,
			types: [
				{ type: 'com.twilio.messaging.compliance.brand-registration.brand-failure' },
				{ type: 'com.twilio.messaging.compliance.brand-registration.brand-unverified' },
				{ type: 'com.twilio.messaging.compliance.brand-registration.brand-registered' },
				{ type: 'com.twilio.messaging.compliance.campaign-registration.campaign-submitted' },
				{ type: 'com.twilio.messaging.compliance.campaign-registration.campaign-failure' },
				{ type: 'com.twilio.messaging.compliance.campaign-registration.campaign-approved' },
			],
		}))

	return res
}

export const twilioFetchA2PBrand = async ({
	brandRegistrationSid,
	team,
}: {
	brandRegistrationSid: string
	team: TeamEntity
}) => {
	const brand = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.brandRegistrations(brandRegistrationSid)
		.fetch())

	return brand
}

export const twilioFetchA2PCampaign = async ({
	messagingServiceSid,
	team,
}: {
	messagingServiceSid: string
	team: TeamEntity
}) => {
	const COMPLIANCE_TYPE = 'QE2c6890da8086d771620e9b13fadeba0b'

	const campaign = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.services(messagingServiceSid)
		.usAppToPerson(COMPLIANCE_TYPE)
		.fetch())

	return campaign
}

export const twilioFetchA2PCampaignUsecases = async ({
	messagingServiceSid,
	brandRegistrationSid,
	team,
}: {
	messagingServiceSid: string,
	brandRegistrationSid: string,
	team: TeamEntity
}) => {
	const { usAppToPersonUsecases } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.services(messagingServiceSid)
		.usAppToPersonUsecases
		.fetch({ brandRegistrationSid }))

	return usAppToPersonUsecases
}

export const twilioRemoveEndUserAndAssignment = async ({
	trustProductSid,
	friendlyName,
	team,
}: {
	trustProductSid: string,
	friendlyName: string,
	team: TeamEntity
}) => {
	const endUserList = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers
		.list())

	const assignments = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1
		.trustProducts(trustProductSid)
		.trustProductsEntityAssignments
		.list())

	assignments.map(async (el) => {
		await el.remove()
	})

	endUserList.map(async (el) => {
		if (el.friendlyName === friendlyName) {
			await el.remove()
		}
	})
}

export const twilioRemoveA2PCampaign = async ({
	messagingServiceSid,
	team,
}: {
	messagingServiceSid: string,
	team: TeamEntity
}) => {
	const COMPLIANCE_TYPE = 'QE2c6890da8086d771620e9b13fadeba0b' // hardcoded value for deleting campaigns

	// delete the campaign
	await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.services(messagingServiceSid)
		.usAppToPerson(COMPLIANCE_TYPE)
		.remove()
	)
}

export const twilioConnectPhoneToMessagingService = async ({
	messagingServiceSid,
	phoneNumberSid,
	team,
}: {
	messagingServiceSid: string,
	phoneNumberSid: string,
	team: TeamEntity
}) => {
	const res = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
		.services(messagingServiceSid)
		.phoneNumbers
		.create({
			phoneNumberSid,
		}))

	return res
}

export const twilioCreateSecondaryBusinessProfile = async ({
	friendlyName,
	email,
	team,
}: {
	friendlyName: string
	email: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles
		.create({
			friendlyName,
			email,
			policySid: 'RNdfbf3fae0e1107f8aded0e7cead80bf5',
		}))

	return sid
}

export const twilioConnectSecondaryProfileToBusiness = async ({
	secondaryBusinessProfileSid,
	primaryBusinessProfileSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	primaryBusinessProfileSid: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
		.customerProfilesEntityAssignments
		.create({ objectSid: primaryBusinessProfileSid }))

	return sid
}

export const twilioCreateSupportingDoc = async ({
	addressSid,
	friendlyName,
	team,
}: {
	addressSid: string
	friendlyName: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.supportingDocuments
		.create({
			attributes: {
				address_sids: addressSid,
			},
			friendlyName,
			type: 'customer_profile_address',
		}))

	return sid
}

export const twilioConnectSupportingDoc = async ({
	secondaryBusinessProfileSid,
	supportingDocSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	supportingDocSid: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
		.customerProfilesEntityAssignments
		.create({ objectSid: supportingDocSid }))

	return sid
}

export const twilioCreateBusinessInfoForSecBusProfile = async ({
	attributes,
	friendlyName,
	team,
}: {
	attributes: {
		businessName: string,
		businessIdentity: 'direct_customer' | 'isv_reseller_or_partner' | 'unknown',
		businessType: string,
		businessIndustry: string,
		businessRegistrationIdentifier: string,
		businessRegistrationNumber: string,
		businessRegionsOfOperation: string,
		websiteUrl: string,
		socialMediaProfileUrls?: string,
	},
	friendlyName: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers
		.create({
			attributes: {
				business_name: attributes.businessName,
				business_identity: attributes.businessIdentity,
				business_type: attributes.businessType,
				business_industry: attributes.businessIndustry,
				business_registration_identifier: attributes.businessRegistrationIdentifier,
				business_registration_number: attributes.businessRegistrationNumber,
				business_regions_of_operation: attributes.businessRegionsOfOperation,
				website_url: attributes.websiteUrl,
				social_media_profile_urls: attributes.socialMediaProfileUrls,
			},
			friendlyName,
			type: 'customer_profile_business_information',
		}))

	return sid
}

export const twilioConnectBusinessToSecBusProfile = async ({
	secondaryBusinessProfileSid,
	secondaryBusinessInfoSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	secondaryBusinessInfoSid: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
		.customerProfilesEntityAssignments
		.create({ objectSid: secondaryBusinessInfoSid }))

	return sid
}

export const twilioCreateAuthRepresentativeForSecBus = async ({
	attributes,
	friendlyName,
	team,
}: {
	attributes: {
		firstName: string,
		lastName: string,
		email: string,
		phoneNumber: string,
		businessTitle: string,
		jobPosition: string,
	},
	friendlyName: string,
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers
		.create({
			attributes: {
				first_name: attributes.firstName,
				last_name: attributes.lastName,
				email: attributes.email,
				phone_number: attributes.phoneNumber,
				business_title: attributes.businessTitle,
				job_position: attributes.jobPosition,
			},
			friendlyName,
			type: 'authorized_representative_1',
		}))

	return sid
}

export const twilioConnectAuthRepresentativeToSecBus = async ({
	secondaryBusinessProfileSid,
	authRepresentativeSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	authRepresentativeSid: string
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
		.customerProfilesEntityAssignments
		.create({ objectSid: authRepresentativeSid }))

	return sid
}

export const twilioConnectPhoneNumberToCustomerProfile = async ({
	secondaryBusinessProfileSid,
	phoneNumberSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	phoneNumberSid: string,
	team: TeamEntity
}) => {
	try {
		const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
			.customerProfilesChannelEndpointAssignment
			.create({
				channelEndpointSid: phoneNumberSid,
				channelEndpointType: 'phone-number',
			}))

		return sid
	} catch (error) {
		logger.debug(`Phone number (sid ${phoneNumberSid}) is already connected to the account. Trying other numbers...`)
	}
}

export const twilioSubmitSecondaryBusinessProfile = async ({
	secondaryBusinessProfileSid,
	team,
}: {
	secondaryBusinessProfileSid: string
	team: TeamEntity
}) => {
	const { status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(secondaryBusinessProfileSid)
		.update({
			status: 'pending-review',
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/secondary_customer_profile`,
		}))

	return status
}

export const twilioCreateShakenStirTrustProduct = async ({
	friendlyName,
	email,
	team,
}: {
	friendlyName: string,
	email: string,
	team: TeamEntity
}) => {
	const { sid, status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts
		.create({
			friendlyName,
			email,
			policySid: 'RN7a97559effdf62d00f4298208492a5ea', // this is hardcoded check https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir/shakenstir-onboarding/shaken-stir-trust-hub-api-isvs-single-project#create-shakenstir-trust-product
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/shaken_stir`,
		}))

	return { sid, status }
}

export const twilioConnectShakenStirTrustProduct = async ({
	trustProductSid,
	secondaryBusinessProfileSid,
	team,
}: {
	trustProductSid: string,
	secondaryBusinessProfileSid: string,
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid)
		.trustProductsEntityAssignments
		.create({ objectSid: secondaryBusinessProfileSid }))

	return sid
}

// ONLY CONNECT NUMBERS THAT CONNECTED TO SECONDARY BUSINESS PROFILE ABOVE
export const twilioAssignPhoneNumberToShakenStirProduct = async ({
	trustProductSid,
	phoneNumberSid,
	team,
}: {
	trustProductSid: string
	phoneNumberSid: string,
	team: TeamEntity
}) => {
	const { sid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid)
		.trustProductsChannelEndpointAssignment
		.create({
			channelEndpointType: 'phone-number',
			channelEndpointSid: phoneNumberSid,
		}))

	logger.debug(`Assigned Twilio Phone Number to Shaken/Stir ${phoneNumberSid}`)

	return sid
}

export const twilioSubmitShakenStir = async ({
	trustProductSid,
	team,
}: {
	trustProductSid: string
	team: TeamEntity
}) => {
	const { sid, status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid)
		.update({ status: 'pending-review' }))

	return { sid, status }
}

export const onTwilioShakenStirApproved = async (team: TeamEntity) => {
	logger.info(`Twilio A2P Trust Bundle evaluation approved for team ${team.name}`)

	try {
		const teamMemberEmails = await getTeamUserEmails(team.id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email,
				type: TransactionalEmail.SHAKEN_STIR_APPROVED,
				data: {
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const onTwilioShakenStirRejected = async (team: TeamEntity, failure_reason: string) => {
	logger.info(`Twilio A2P Trust Bundle evaluation rejected for team ${team.name}`)

	try {
		const teamMemberEmails = await getTeamUserEmails(team.id)

		for (const email of teamMemberEmails) {
			await sendTransactionalEmail({
				email,
				type: TransactionalEmail.SHAKEN_STIR_REJECTED,
				data: {
					failure_reason,
					team_name: team.name,
				},
			})
		}
	} catch (error) {
		captureError(error)
	}
}

export const twilioFetchPrimaryCustomerProfile = async (team: TeamEntity) => {
	const profile = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid).fetch())

	return profile
}

export const createCall = async ({
	toNumber,
	interview_id,
}: {
	toNumber: string
	interview_id: string
}) => {
	const interview = await InterviewEntity.findOneOrFail({
		where: {
			id: interview_id,
		},
		relations: ['team', 'caller_id', 'outbound_phone_number'],
	})

	let from
	let twilio = twilioClient(interview.team.twilio_account_sid, interview.team.twilio_account_secret)

	if (interview.caller_id) {
		logger.info(`Creating call for interview ${interview.id} from caller id: ${interview.caller_id.phone_number}`)
		from = interview.caller_id.phone_number
	} else if (!interview.outbound_phone_number) {
		logger.info(`Creating call for interview ${interview.id} from default phone number`)
		from = process.env.OUTBOUND_PHONE_NUMBER
		twilio = masterTwilioClient()
	} else {
		logger.info(`Creating call for interview ${interview.id} from interview phone number: ${interview.outbound_phone_number.phone_number}`)
		from = interview.outbound_phone_number.phone_number
	}

	const { sid } = await withExponentialBackoff(async () =>
		await twilio.calls.create({
			url: `https://${process.env.API_URL}/webhook/twilio/twiml`,
			to: toNumber,
			from,
			machineDetection: 'DetectMessageEnd',
			machineDetectionTimeout: 60,
			machineDetectionSpeechEndThreshold: 1000,
			asyncAmd: 'false',
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/status`,
			asyncAmdStatusCallback: `https://${process.env.API_URL}/webhook/twilio/amd`,
			statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
		})
	)

	return sid
}
