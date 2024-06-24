/* eslint-disable max-len */
import { CustomerProfilesEvaluationsInstance } from 'twilio/lib/rest/trusthub/v1/customerProfiles/customerProfilesEvaluations'
import { TeamEntity } from '../../modules/team/db/team.entity'
import { A2P_BRAND_STATUS, A2P_CAMPAIGN_STATUS, A2P_TRUST_BUNDLE_STATUS } from '../../modules/team/db/team.types'
import { UserEntity } from '../../modules/user/db/user.entity'
import { captureError } from '../../util/error.util'
import logger from '../../util/logger.util'
import {
	assignPhoneNumberToCnam,
	createTwilioCustomerProfileForTeam,
	createTwilioSubaccountForTeam,
	resetTwilioEvaluation, twilioAssignEndUserToTrustBundle, twilioCreateA2PBrand, twilioCreateA2PEndUser, twilioCreateA2PTrustBundle, submitShakenStir, twilioCreateWebhookSink, twilioRunEvaluationsOnTrustProduct, twilioSubmitTrustBundle,
} from './twilio.helpers'
import { withExponentialBackoff } from '../../util/helpers.util'
import { masterTwilioClient, twilioClient, twilioClientWithArgs } from '.'
import { PhoneNumberEntity } from '../../modules/phone_number/db/phone_number.entity'
import { redisRead, redisWrite } from '../redis'
import EventUtil from '../event'
import { isProduction } from '../../util/env.util'
import { UsAppToPersonListInstanceCreateOptions } from 'twilio/lib/rest/messaging/v1/service/usAppToPerson'

export const twilioSubmitA2PBundleAndBrand = async ({
	team,
	isMock,
}: {
	team: TeamEntity,
	isMock?: boolean
}) => {
	const POLICY_SID = 'RNb0d4771c2c98518d916a3d4cd70a8f8b' // hardcoded -- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api#2-create-an-a2p-trust-product

	const companyType = team.business_metadata.company_type
	const stockExchange = team.business_metadata.stock_exchange
	const stockTicker = team.business_metadata.stock_ticker

	const friendlyName = `a2p-for-${team.id}`
	const submitEmail = 'support@thought.ly'

	const attributes = companyType === 'public' ? {
		company_type: companyType,
		stock_exchange: stockExchange,
		stock_ticker: stockTicker,
	} : {
		company_type: companyType,
	}

	if (team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.REGISTERED ||
		team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.PENDING ||
		team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.PENDING_REVIEW ||
		team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.IN_REVIEW) {
		logger.info(`Brand or Bundle is already in review for team: ${team.name}, returning...`)
		return {
			data: {
				success: true,
			},
		}
	}

	if (team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.TWILIO_APPROVED &&
		team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.APPROVED) {
		/* Check if a2p campaign is rejected, and if so submit again */
		if (team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.FAILURE) {
			logger.info('Submitting a2p campaign...')
			const campaignStatus = await twilioSubmitA2PCampaign(team)
			if (!campaignStatus.data.success) {
				return {
					data: campaignStatus.data,
				}
			}
		}

		return {
			data: {
				success: true,
			},
		}
	}

	try {
		const trustProductSid = await twilioCreateA2PTrustBundle({ friendlyName, email: submitEmail, policySid: POLICY_SID, team })
		logger.debug(`Created A2P Trust bundle for team ${team.name}, sid: ${trustProductSid}`)

		// await twilioRemoveEndUserAndAssignment(friendlyName, trustProductSid)

		const objectSid = await twilioCreateA2PEndUser({ friendlyName, attributes, team })

		logger.debug(`Created A2P End User for team ${team.name} and for type ${attributes.company_type} company`)

		await twilioAssignEndUserToTrustBundle({ trustProductSid, objectSid, team })

		logger.debug('Assigned end user to a2p trust bundle')

		await twilioAssignEndUserToTrustBundle({ trustProductSid, objectSid: team.twilio_metadata.twilio_customer_profile_sid, team })

		logger.debug('Assigned customer profile to a2p trust bundle')

		const { status, results } = await twilioRunEvaluationsOnTrustProduct({ trustProductSid, policySid: POLICY_SID, team })

		logger.debug(`Ran evaluations on a2p trust product, status: ${status}`)

		if (status === 'noncompliant') {
			const errors: {
				reason: string
				field: string
			}[] = []

			for (const result of results) {
				for (const field of result.fields) {
					if (!field.passed) {
						errors.push({
							reason: field.failure_reason,
							field: field.friendly_name,
						})
					}
				}
			}

			return {
				data: {
					success: false,
					errors,
				},
			}
		}

		// only submit if it is rejected or has not yet submitted
		if (
			!team.twilio_metadata.twilio_customer_a2p_bundle_status ||
			team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.DRAFT ||
			team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.TWILIO_REJECTED
		) {
			await twilioSubmitTrustBundle({ trustProductSid, team })
			logger.debug('Submitted A2P Trust Bundle')

			team.twilio_metadata.twilio_customer_bundle_sid = trustProductSid
			await team.save()
		}

		// only create if it is rejected or has not yet submitted and bundle is approved
		if (team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.TWILIO_APPROVED && (
			!team.twilio_metadata.twilio_customer_a2p_brand_status || team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.DRAFT || team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.FAILED
		)) {
			const sid = await twilioCreateA2PBrand({
				team,
				a2PProfileBundleSid: trustProductSid,
				customerProfileBundleSid: team.twilio_metadata.twilio_customer_profile_sid,
				isMock,
			})

			team.twilio_metadata.twilio_customer_brand_registration_sid = sid
			team.twilio_metadata.twilio_customer_a2p_brand_status = A2P_BRAND_STATUS.PENDING
			await team.save()

			logger.info(`Created A2P Brand for team ${team.name}, mock: ${isMock}, sid: ${sid}`)
		}

		const sinkStatus = await twilioCreateWebhookSink(team)

		if (sinkStatus === 'failed') {
			return {
				data: {
					success: false,
					errors: [{ reason: 'sink subscription failed', field: 'sink subscription' }],
				},
			}
		}

		return {
			data: {
				success: true,
			},
		}
	} catch (error) {
		captureError(error)

		return {
			data: {
				success: false,
				errors: [{
					reason: 'An unknown error occurred while submitting or creating a2p trust bundle. Please try again.',
					field: 'a2p_trust_bundle',
				}],
			},
		}
	}
}

export const twilioSubmitBusinessForReview = async (team: TeamEntity, user: UserEntity) => {
	if (team.twilio_metadata.twilio_customer_profile_status === 'twilio-approved' ||
		team.twilio_metadata.twilio_customer_profile_status === 'in-review' ||
		team.twilio_metadata.twilio_customer_profile_status === 'pending-review') {
		return {
			data: {
				success: true,
			},
		}
	}

	const _returnUnknownError = () => ({
		data: {
			success: false,
			errors: [{
				reason: 'An unknown error occurred while submitting the business metadata for review. Please try again.',
				field: 'business_metadata',
			}],
		},
	})

	let evaluationResponse: CustomerProfilesEvaluationsInstance | null = null

	let businessInformationSid = null
	let authorizedRepSid = null
	let addressSid = null

	await resetTwilioEvaluation(team)

	try {
		const [
			businessInformation,
			authorizedRep,
			address,
		] = await Promise.all([
			withExponentialBackoff(() => twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers.create({
				attributes: {
					business_name: team.business_metadata.name,
					website_url: team.business_metadata.website_url,
					business_regions_of_operation: team.business_metadata.regions_of_operation,
					business_type: team.business_metadata.type,
					business_registration_identifier: team.business_metadata.registration_id_type,
					business_identity: 'direct_customer',
					business_industry: team.business_metadata.industry,
					business_registration_number: team.business_metadata.registration_number,
				},
				friendlyName: team.name,
				type: 'customer_profile_business_information',
			})),
			withExponentialBackoff(() => twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers.create({
				attributes: {
					job_position: team.business_metadata.authorized_signatory.title,
					first_name: team.business_metadata.authorized_signatory.first_name,
					last_name: team.business_metadata.authorized_signatory.last_name,
					email: user.email,
					phone_number: user.phone_number,
					business_title: team.business_metadata.authorized_signatory.title,
				},
				friendlyName: 'auth_rep_1',
				type: 'authorized_representative_1',
			})),
			withExponentialBackoff(() => twilioClient(team.twilio_account_sid, team.twilio_account_secret).addresses.create({
				customerName: team.name,
				street: team.business_metadata.address.line_1,
				streetSecondary: team.business_metadata.address.line_2,
				city: team.business_metadata.address.city,
				region: team.business_metadata.address.state,
				postalCode: team.business_metadata.address.postal_code,
				isoCountry: team.business_metadata.address.country,
			})),
		])

		logger.debug(`Created Twilio TrustHub entities for team ${team.name}`)

		businessInformationSid = businessInformation.sid
		authorizedRepSid = authorizedRep.sid
		addressSid = address.sid

		const { sid: supportingDocumentSid } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.supportingDocuments.create({
			attributes: {
				address_sids: addressSid,
			},
			friendlyName: 'address',
			type: 'customer_profile_address',
		}))

		logger.debug(`Created Twilio TrustHub supporting document for team ${team.name}`)

		await Promise.all([
			businessInformationSid,
			authorizedRepSid,
			supportingDocumentSid,
		].map(id => withExponentialBackoff(() => twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
			.customerProfilesEntityAssignments
			.create({ objectSid: id })
		)))

		logger.debug(`Assigned Twilio TrustHub entities to team ${team.name}`)

		await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
			.customerProfilesEntityAssignments
			.create({ objectSid: process.env.TWILIO_PRIMARY_CUSTOMER_SID })
			.catch(() => { logger.warn('Business assignment to primary Twilio account failed ') })
		)
		logger.debug(`Assigned Twilio TrustHub customer profile to team ${team.name}`)

		const { sid: policySid } = await withExponentialBackoff(async () => twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.policies.list()
			.then((policies) => policies.find(policy =>
				policy.friendlyName.toLowerCase() === 'secondary customer profile of type business'
			)))

		logger.debug(`Found Twilio TrustHub policy for team ${team.name}: ${policySid}`)

		evaluationResponse = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
			.customerProfilesEvaluations
			.create({ policySid: policySid }))

		logger.debug(`Ran Twilio TrustHub customer profile evaluation for team ${team.name}`)
	} catch (error) {
		captureError(error)

		await resetTwilioEvaluation(team)

		return _returnUnknownError()
	}

	if (evaluationResponse.status === 'noncompliant') {
		const errors: {
			reason: string
			field: string
		}[] = []

		for (const result of evaluationResponse.results) {
			for (const field of result.fields) {
				if (!field.passed) {
					errors.push({
						reason: field.failure_reason,
						field: field.friendly_name,
					})
				}
			}
		}

		return {
			data: {
				success: false,
				errors,
			},
		}
	}

	const { status } = await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
		.update({ status: 'pending-review' }))

	team.twilio_metadata.twilio_customer_profile_status = status
	await team.save()

	logger.debug(`Submitted Twilio TrustHub customer profile for review for team ${team.name}, status: ${status}`)

	if (status !== 'pending-review' && status !== 'in-review') {
		return _returnUnknownError()
	}

	team.business_metadata = {
		...team.business_metadata,
		business_information_sid: businessInformationSid,
		authorized_rep_sid: authorizedRepSid,
		address_sid: addressSid,
		email: user.email,
	}
	await team.save()

	return {
		data: {
			success: true,
		},
	}
}

export const twilioSubmitA2PCampaign = async (team: TeamEntity) => {
	const optInKeywords = team.business_metadata.campaign_data.opt_in_keywords
	const optOutKeywords = team.business_metadata.campaign_data.opt_out_keywords
	const helpKeywords = team.business_metadata.campaign_data.help_keywords
	const optInMessage = team.business_metadata.campaign_data.opt_in_message
	const optOutMessage = team.business_metadata.campaign_data.opt_out_message
	const helpMessage = team.business_metadata.campaign_data.help_message
	const description = team.business_metadata.campaign_data.description
	const messageFlow = team.business_metadata.campaign_data.message_flow
	const messageSamples = team.business_metadata.campaign_data.message_samples
	const usAppToPersonUsecase = team.business_metadata.campaign_data.usecase
	const hasEmbeddedLinks = team.business_metadata.campaign_data.has_embedded_links
	const hasEmbeddedPhone = team.business_metadata.campaign_data.has_embedded_phone

	/* if (team.twilio_metadata.twilio_customer_a2p_bundle_status !== A2P_TRUST_BUNDLE_STATUS.TWILIO_APPROVED &&
		team.twilio_metadata.twilio_customer_a2p_brand_status !== A2P_BRAND_STATUS.APPROVED) {
		logger.info(`Bundle or Brand has not approved yet for team ${team.name}, returning...`)
		return {
			data: {
				success: false,
				errors: [{
					reason: 'Either Trust Bundle or Brand has not approved yet. Please submit campaign after both of these are approved',
					field: 'campaign',
				}],
			},
		}
	} */

	if (team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.SUCCESS ||
		team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.PENDING) {
		logger.info(`A2P Campaign is already approved or submitted for team ${team.name}, returning...`)
		return {
			data: {
				success: false,
				errors: [{
					reason: 'Campaign is already approved or submitted.',
					field: 'campaign',
				}],
			},
		}
	}

	try {
		logger.info(`Submitting campaign for team ${team.name}...`)

		const campaignInfo: UsAppToPersonListInstanceCreateOptions = {
			description,
			messageFlow,
			messageSamples,
			usAppToPersonUsecase,
			hasEmbeddedLinks,
			hasEmbeddedPhone,
			brandRegistrationSid: team.twilio_metadata.twilio_customer_brand_registration_sid,
		}

		if (optInKeywords && optInKeywords.length > 0) {
			campaignInfo.optInKeywords = optInKeywords
		}

		if (optInMessage) {
			campaignInfo.optInMessage = optInMessage
		}

		if (optOutKeywords && optOutKeywords.length > 0) {
			campaignInfo.optOutKeywords = optOutKeywords
		}

		if (optOutMessage) {
			campaignInfo.optOutMessage = optOutMessage
		}

		if (helpKeywords && helpKeywords.length > 0) {
			campaignInfo.helpKeywords = helpKeywords
		}

		if (helpMessage) {
			campaignInfo.helpMessage = helpMessage
		}

		await withExponentialBackoff(async () => await twilioClient(team.twilio_account_sid, team.twilio_account_secret).messaging.v1
			.services(team.twilio_metadata.twilio_customer_messaging_service_sid)
			.usAppToPerson
			.create({
				...campaignInfo,
			}))

		logger.info(`Successfully submitted campaign for team ${team.name}!`)

		team.twilio_metadata.twilio_customer_a2p_campaign_status = A2P_CAMPAIGN_STATUS.PENDING
		await team.save()

		return {
			data: {
				success: true,
			},
		}
	} catch (error) {
		captureError(error)

		// https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands#troubleshoot-and-rectify-a2p-campaign-submission-failures
		// it is recommended that on failure campaign should be edited from the twilio console

		return {
			data: {
				success: false,
				errors: [{
					reason: 'An unknown error has occurred. Please try submitting again.',
					field: 'campaign',
				}],
			},
		}
	}
}

export const emitTwilioMigrationCheckEvent = async (team: TeamEntity) => {
	const redisLockKey = `team:${team.id}:twilio-migration-lock`

	const redisLock = await redisRead(redisLockKey)

	if (redisLock) {
		return
	}

	await redisWrite(redisLockKey, 'true', {
		EX: 60 * 60 * 24, // 24 hours
	})

	await EventUtil.asyncEmit('CHECK_FOR_TWILIO_MIGRATIONS', { team_id: team.id })
}

export const checkForTwilioTeamMigrations = async (teamArg: TeamEntity) => {
	logger.info(`Checking for Twilio migrations for team ${teamArg.name}`)

	// check if team has twilio subaccount

	try {
		const team = await TeamEntity.findOneOrFail({
			where: { id: teamArg.id },
		})

		if (!team.twilio_account_sid) {
			logger.info(`Creating Twilio subaccount for team ${team.name}`)
			const { sid, secret } = await createTwilioSubaccountForTeam(team)

			team.twilio_account_sid = sid
			team.twilio_account_secret = secret

			await team.save()

			logger.info(`Created Twilio subaccount ${team.twilio_account_sid} for team ${team.name}`)
		}
	} catch (error) {
		captureError(error)
	}

	// check if team has twilio auth token

	try {
		const team = await TeamEntity.findOneOrFail({
			where: { id: teamArg.id },
		})

		if (!team.twilio_account_secret && team.twilio_account_sid) {
			logger.info(`Fetching Twilio auth token for team ${team.name}`)

			const { authToken } = await masterTwilioClient().api.v2010.accounts(team.twilio_account_sid).fetch()

			team.twilio_account_secret = authToken
			await team.save()
		}
	} catch (error) {
		captureError(error)
	}

	// check if team has twilio secondary customer profile

	try {
		const team = await TeamEntity.findOneOrFail({
			where: { id: teamArg.id },
		})

		if (!team.twilio_metadata.twilio_customer_profile_sid && team.twilio_account_sid) {
			logger.info(`Creating Twilio customer profile for team ${team.name}`)
			team.twilio_metadata.twilio_customer_profile_sid = await createTwilioCustomerProfileForTeam(team, 'support@thought.ly')
			await team.save()
		}
	} catch (error) {
		captureError(error)
	}

	// check if phone numbers are assigned to a different subaccount

	try {
		const team = await TeamEntity.findOneOrFail({
			where: { id: teamArg.id },
		})

		const phoneNumbers = await PhoneNumberEntity.find({
			where: { team: { id: teamArg.id } },
		})

		let subaccounts: { sid: string, secret: string }[] = []

		for (const phoneNumber of phoneNumbers) {
			await twilioClient(team.twilio_account_sid, team.twilio_account_secret).incomingPhoneNumbers(phoneNumber.twilio_sid).fetch()
				.catch(async () => {
					logger.warn(`Error fetching phone number from Twilio subaccount for team ${team.name}`)
					const masterPhoneNumber = await masterTwilioClient().incomingPhoneNumbers(phoneNumber.twilio_sid).fetch()
						.catch(async () => {
							logger.warn('Error fetching phone number from Twilio master account, fetching other subaccounts')

							if (!subaccounts.length) {
								subaccounts = await masterTwilioClient().api.accounts.list().then(accounts => accounts.map(account => ({
									sid: account.sid,
									secret: account.authToken,
								})))
							}

							await Promise.all(subaccounts.map(async ({ sid, secret }) => {
								const data = await twilioClientWithArgs({
									accountSid: sid,
								}).incomingPhoneNumbers(phoneNumber.twilio_sid).fetch()
									.catch(() => null)

								if (data) {
									logger.info(`Migrating phone number ${phoneNumber.phone_number} to subaccount ${sid}`)

									await withExponentialBackoff(async () =>
										await twilioClientWithArgs({ accountSid: sid }).incomingPhoneNumbers(phoneNumber.twilio_sid).update({
											accountSid: team.twilio_account_sid,
										})
									)
								}
							}))
						})

					if (masterPhoneNumber) {
						await withExponentialBackoff(async () =>
							await masterTwilioClient().incomingPhoneNumbers(phoneNumber.twilio_sid).update({
								accountSid: team.twilio_account_sid,
							})
						)
					}
				})
		}
	} catch (error) {
		captureError(error)
	}

	// check if phone numbers are assigned to a different secondary customer profile

	try {
		const team = await TeamEntity.findOneOrFail({
			where: { id: teamArg.id },
		})

		const phoneNumbers = await PhoneNumberEntity.find({
			where: { team: { id: teamArg.id } },
		})

		for (const phoneNumber of phoneNumbers) {
			const assignments = await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid).customerProfilesChannelEndpointAssignment.list()

			if (!assignments.length) {
				logger.info(`Assigning phone number ${phoneNumber.phone_number} to customer profile for team ${team.name}`)
				await withExponentialBackoff(async () =>
					await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
						.customerProfilesChannelEndpointAssignment.create({
							channelEndpointSid: phoneNumber.twilio_sid,
							channelEndpointType: 'phone-number',
						})
				)
			} else {
				for (const assignment of assignments) {
					if (
						assignment.channelEndpointType === 'phone-number' &&
						assignment.channelEndpointSid === phoneNumber.twilio_sid &&
						assignment.customerProfileSid !== team.twilio_metadata.twilio_customer_profile_sid
					) {
						logger.info(`Removing phone number ${phoneNumber.phone_number} from customer profile ${assignment.customerProfileSid} for team ${team.name}`)

						// remove current assignment

						await withExponentialBackoff(async () =>
							await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
								.customerProfilesChannelEndpointAssignment(assignment.sid).remove()
						)

						logger.info(`Assigning phone  number ${phoneNumber.phone_number} to new customer profile for team ${team.name}`)

						// assign to new customer profile

						await withExponentialBackoff(async () =>
							await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.customerProfiles(team.twilio_metadata.twilio_customer_profile_sid)
								.customerProfilesChannelEndpointAssignment.create({
									channelEndpointSid: phoneNumber.twilio_sid,
									channelEndpointType: 'phone-number',
								})
						)
					}
				}
			}
		}
	} catch (error) {
		captureError(error)
	}

	if (teamArg.twilio_metadata.twilio_customer_profile_status === 'twilio-approved') {
		// check if team has submitted a2p bundle and brand

		try {
			const team = await TeamEntity.findOneOrFail({
				where: { id: teamArg.id },
			})

			if ((team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.DRAFT ||
				!team.twilio_metadata.twilio_customer_a2p_bundle_status
			) &&
				(team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.DRAFT ||
					!team.twilio_metadata.twilio_customer_a2p_brand_status
				)) {
				/* Only submit if they aren't submitted yet, otherwise it'd throw an error (check: https://thoughtly.sentry.io/issues/5421735177/events/1797fd7c64f34c6fbd425529f701ddb6/?project=4505699564126208) */
				logger.info(`Submitting A2P bundle and brand for team ${team.name}`)
				await twilioSubmitA2PBundleAndBrand({ team })
			}
		} catch (error) {
			captureError(error)
		}

		/* check if brand submitted */
		try {
			const team = await TeamEntity.findOneOrFail({
				where: { id: teamArg.id },
			})

			if ((team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.IN_REVIEW ||
				team.twilio_metadata.twilio_customer_a2p_bundle_status === A2P_TRUST_BUNDLE_STATUS.TWILIO_APPROVED
			) &&
				team.twilio_metadata.twilio_customer_bundle_sid &&
				team.twilio_metadata.twilio_customer_profile_sid &&
				(team.twilio_metadata.twilio_customer_a2p_brand_status === A2P_BRAND_STATUS.DRAFT ||
					!team.twilio_metadata.twilio_customer_a2p_brand_status
				)) {
				/* Only submit if they aren't submitted yet, otherwise it'd throw an error (check: https://thoughtly.sentry.io/issues/5421735177/events/1797fd7c64f34c6fbd425529f701ddb6/?project=4505699564126208) */
				logger.info(`Submitting A2P brand for team ${team.name}`)
				/* submit the brand once the bundle is in review */
				const brandSid = await twilioCreateA2PBrand({
					team,
					a2PProfileBundleSid: team.twilio_metadata.twilio_customer_bundle_sid,
					customerProfileBundleSid: team.twilio_metadata.twilio_customer_profile_sid,
					isMock: !isProduction(),
				})

				logger.info(`Submitted A2P Brand for team ${team.name}, mock: ${!isProduction()}, sid: ${brandSid}`)
			}
		} catch (error) {
			logger.error(`Error submitting brand, error: ${error}`)
			captureError(error)
		}

		// check if team has submitted cnam

		try {
			const team = await TeamEntity.findOneOrFail({
				where: { id: teamArg.id },
			})

			const redisLockKey = `team:${team.name}:twilio-cnam-lock`

			const redisLock = await redisRead(redisLockKey)

			/* since we call this function too frequently, this guard is necessary to prevent submitting too many times */
			if (redisLock) {
				logger.info(`Just submitted cnam for team: ${team}`)
			} else if (!team.twilio_metadata.twilio_cnam_trust_product_status) {
				await redisWrite(redisLockKey, 'true', { EX: 60 })

				logger.info(`Submitting CNAM trust product for team ${team.name}`)

				await twilioSubmitCnamRequest(team)
			}
		} catch (error) {
			captureError(error)
		}

		// check if team has submitted shaken/stir

		try {
			const team = await TeamEntity.findOneOrFail({
				where: { id: teamArg.id },
				relations: ['phone_numbers'],
			})

			const redisLockKey = `team:${team.name}:twilio-shakenstir-lock`

			const redisLock = await redisRead(redisLockKey)

			/* since we call this function too frequently, this guard is necessary to prevent submitting too many times */
			if (redisLock) {
				logger.info(`Just submitted shaken-stir for team: ${team}`)
			} else if (team.twilio_metadata.twilio_shaken_stir_status === 'draft' ||
				!team.twilio_metadata.twilio_shaken_stir_status
			) {
				/* if it is not submitted yet, submit it */
				await redisWrite(redisLockKey, 'true', { EX: 60 })

				logger.info(`Submitting shaken/stir for team ${team.name}`)
				await submitShakenStir(team)
			}
		} catch (error) {
			captureError(error)
		}
	}
}

export const twilioSubmitCnamRequest = async (team: TeamEntity) => {
	if (team.twilio_metadata.twilio_customer_cnam_trust_product_sid) {
		logger.warn(`CNAM trust product already exists for team ${team.name}`)
		return
	}

	logger.info('Creating CNAM trust product')

	const cnamDisplayName = team.name.slice(0, 14)

	const { sid: trustProductSid } = await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts
		.create({
			email: 'support@thought.ly',
			friendlyName: cnamDisplayName,
			policySid: 'RNf3db3cd1fe25fcfd3c3ded065c8fea53', // hardcoded value for CNAM
			statusCallback: `${process.env.API_URL}/webhook/twilio/cnam/status`,
		})

	logger.info(`Created CNAM trust product for team ${team.name}`)

	team.twilio_metadata.twilio_customer_cnam_trust_product_sid = trustProductSid
	await team.save()

	await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid)
		.trustProductsEntityAssignments
		.create({
			objectSid: team.twilio_metadata.twilio_customer_profile_sid,
		})
		.catch(error => {
			logger.warn(`Error connecting CNAM trust product to customer profile for team ${team.name}: ${error.message}`)
		})

	logger.info(`Connected CNAM trust product to customer profile for team ${team.name}`)

	const { sid: endUserSid } = await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.endUsers.create({
		attributes: {
			cnam_display_name: cnamDisplayName,
		},
		friendlyName: cnamDisplayName,
		type: 'cnam_information',
	})

	logger.info(`Created CNAM end user for team ${team.name}`)

	await twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid)
		.trustProductsEntityAssignments.create({
			objectSid: endUserSid,
		})
		.catch(error => {
			logger.warn(`Error connecting CNAM end user to trust product for team ${team.name}: ${error.message}`)
		})

	logger.info(`Connected CNAM end user to trust product for team ${team.name}`)

	// Assign phone numbers

	const phoneNumbers = await PhoneNumberEntity.find({
		where: { team: { id: team.id } },
	})

	for (const phoneNumber of phoneNumbers) {
		await assignPhoneNumberToCnam(team, phoneNumber)
			.catch(error => {
				logger.warn(`Error assigning phone number ${phoneNumber.phone_number} to CNAM for team ${team.name}: ${error.message}`)
			})
	}

	logger.info(`Assigned phone numbers to CNAM for team ${team.name}`)

	// Submit trust product

	await withExponentialBackoff(() => twilioClient(team.twilio_account_sid, team.twilio_account_secret).trusthub.v1.trustProducts(trustProductSid).update({
		status: 'pending-review',
	}))

	logger.info(`Submitted CNAM trust product for team ${team.name}`)

	team.twilio_metadata.twilio_cnam_trust_product_status = 'pending-review'
	await team.save()
}
