import { EventMap } from '../event.map'
import { PhoneNumberEntity } from '../../../modules/phone_number/db/phone_number.entity'
import { twilioClient } from '../../twilio'
import logger from '../../../util/logger.util'
import { SubscriptionEntity } from '../../../modules/subscription/db/subscription.entity'
import { IncomingPhoneNumberListInstanceCreateOptions } from 'twilio/lib/rest/api/v2010/account/incomingPhoneNumber'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { captureError } from '../../../util/error.util'
import stripe from '../../stripe'
import { getTeamUserEmails } from '../../../modules/team/api/team.helpers'
import { sendTransactionalEmail } from '../../email'
import { TransactionalEmail } from '../../email/emails.enums'
import { InvoiceEntity } from '../../../modules/invoice/db/invoice.entity'
import { A2P_CAMPAIGN_STATUS } from '../../../modules/team/db/team.types'
import { twilioConnectPhoneToMessagingService } from '../../twilio/twilio.helpers'

const onPhoneNumberPurchased = async ({
	phone_number,
	subscription_id,
}: EventMap['PHONE_NUMBER_PURCHASED']) => {
	const existing = await PhoneNumberEntity.findOneBy({
		phone_number: phone_number,
	})

	if (existing) {
		logger.error(`Phone number ${phone_number} already exists`)
		return
	}

	await new Promise((resolve) => setTimeout(resolve, 5000))

	const subscription = await SubscriptionEntity.findOneOrFail({
		where: {
			stripe_subscription_id: subscription_id,
		},
		relations: ['team', 'invoices'],
	})

	try {
		logger.info(`Purchasing new phone number: ${phone_number}`)

		const newPhoneNumberPayload: IncomingPhoneNumberListInstanceCreateOptions = {
			phoneNumber: phone_number,
			voiceMethod: 'POST',
			voiceUrl: `https://${process.env.API_URL}/webhook/twilio/twiml`,
			statusCallback: `https://${process.env.API_URL}/webhook/twilio/status`,
			smsUrl: `https://${process.env.API_URL}/webhook/twilio/sms`,
			statusCallbackMethod: 'POST',
			friendlyName: `Team ${subscription.team.id}`,
		}

		if (subscription.team.twilio_metadata.twilio_customer_profile_status === 'twilio-approved') {
			// https://thoughtly.sentry.io/issues/5007704619/
			newPhoneNumberPayload.addressSid = subscription.team.business_metadata.address_sid
			// newPhoneNumberPayload.bundleSid = subscription.team.twilio_metadata.twilio_customer_profile_sid
		}

		const number = await withExponentialBackoff(async () =>
			await twilioClient(subscription.team.twilio_account_sid, subscription.team.twilio_account_secret)
				.incomingPhoneNumbers.create(newPhoneNumberPayload))

		await withExponentialBackoff(async () =>
			await twilioClient(subscription.team.twilio_account_sid, subscription.team.twilio_account_secret)
				.trusthub.v1.customerProfiles(subscription.team.twilio_metadata.twilio_customer_profile_sid)
				.customerProfilesChannelEndpointAssignment
				.create({
					channelEndpointType: 'phone-number',
					channelEndpointSid: number.sid,
				}))

		const phoneNumber = PhoneNumberEntity.create({
			phone_number: number.phoneNumber,
			team: subscription.team,
			twilio_sid: number.sid,
			subscription,
		})

		await phoneNumber.save()

		if (subscription.team.twilio_metadata.twilio_customer_profile_status === 'twilio-approved') {
			try {
				await withExponentialBackoff(async () =>
					await twilioClient(subscription.team.twilio_account_sid, subscription.team.twilio_account_secret)
						.trusthub.v1.customerProfiles(subscription.team.twilio_metadata.twilio_customer_profile_sid)
						.customerProfilesChannelEndpointAssignment
						.create({
							channelEndpointType: 'phone-number',
							channelEndpointSid: phoneNumber.twilio_sid,
						})
				)
					.then(() => {
						logger.info(`Assigned phone number ${phoneNumber.phone_number} to Twilio ` +
							`customer profile ${subscription.team.twilio_metadata.twilio_customer_profile_sid}`)
					})
					.catch((error) => {
						captureError(error)
						logger.error(`Error assigning phone number ${phoneNumber.phone_number} to Twilio ` +
							`customer profile ${subscription.team.twilio_metadata.twilio_customer_profile_sid}`)
					})

				// check if campaign exists, if so connect the newly bought phone number
				if (subscription.team.twilio_metadata.twilio_customer_a2p_campaign_status === A2P_CAMPAIGN_STATUS.SUCCESS) {
					await twilioConnectPhoneToMessagingService({
						messagingServiceSid: subscription.team.twilio_metadata.twilio_customer_messaging_service_sid,
						phoneNumberSid: phoneNumber.twilio_sid,
						team: subscription.team,
					})

					logger.info(`Associated phone number ${phoneNumber.phone_number} with Twilio A2P Campaign`)
				}
			} catch (error) {
				captureError(error)
				logger.error(`Error assigning phone number ${phoneNumber.phone_number} to Twilio ` +
					`customer profile ${subscription.team.twilio_metadata.twilio_customer_profile_sid}`)
			}
		}
	} catch (error) {
		captureError(error)
		logger.error(`Error purchasing phone number: ${phone_number}, subscription: ${subscription_id}. Refunding...`)

		try {
			const invoice = await InvoiceEntity.findOneOrFail({
				where: {
					subscription: {
						id: subscription.id,
					},
				},
			})

			await stripe().refunds.create({
				payment_intent: invoice.stripe_metadata.payment_intent as any,
			}).catch(captureError)

			await stripe().subscriptions.cancel(subscription.stripe_subscription_id, {
				prorate: true,
			})
		} catch (error) {
			captureError(error)
		}

		try {
			const teamMemberEmails = await getTeamUserEmails(subscription.team_id)

			for (const email of teamMemberEmails) {
				await sendTransactionalEmail({
					email,
					type: TransactionalEmail.PHONE_NUMBER_PURCHASE_FAILED,
					data: {
						phone_number,
					},
				})
			}
		} catch (error) {
			captureError(error)
		}
	}
}

const onPhoneNumberCancelled = async ({
	phone_number,
	subscription_id,
}: EventMap['PHONE_NUMBER_CANCELLED']) => {
	const existing = await PhoneNumberEntity.findOne({
		where: {
			phone_number: phone_number,
		},
		relations: ['subscription', 'team'],
	})

	if (!existing) {
		logger.warn(`Phone number ${phone_number} has already been removed or does not exist`)
		return
	}

	if (existing.subscription.stripe_subscription_id !== subscription_id) {
		throw new Error(`Phone number ${phone_number} does not belong to subscription ${subscription_id}`)
	}

	logger.info(`Cancelling phone number: ${phone_number}`)

	await withExponentialBackoff(async () =>
		await twilioClient(existing.team.twilio_account_sid, existing.team.twilio_account_secret)
			.incomingPhoneNumbers(existing.twilio_sid)
			.remove()
	)

	await existing.remove()
}

export {
	onPhoneNumberPurchased,
	onPhoneNumberCancelled,
}
