import { Router, raw } from 'express'
import { stripeWebhookHandler } from './stripe.handlers'
import {
	getTwilioTwiml, onTwilioA2PCampaignOrBrandStatusCallback,
	onTwilioAmdStatusCallback,
	onTwilioCallerIdVerification,
	onTwilioCnamStatus,
	onTwilioCustomerA2PBundleStatusCallback, onTwilioCustomerProfileStatusCallback,
	onTwilioRecording, onTwilioShakenStirStatusCallback, onTwilioSms,
	onTwilioStatusCallback, onTwilioTransferStatusCallback,
} from './twilio.handlers'
import { json, urlencoded } from 'express'
import { nangoWebhook } from './nango.handlers'
import { ghlHandler } from './ghl.handlers'

export const externalWebhookRouter = Router()

externalWebhookRouter.post(
	'/stripe',
	raw({ type: 'application/json' }),
	stripeWebhookHandler
)

externalWebhookRouter.use(json({ limit: '2MB' }))
externalWebhookRouter.use(urlencoded({ extended: true }))

externalWebhookRouter.post(
	'/twilio/twiml',
	getTwilioTwiml
)

externalWebhookRouter.post(
	'/twilio/recording',
	onTwilioRecording
)

externalWebhookRouter.post(
	'/twilio/status',
	onTwilioStatusCallback
)

externalWebhookRouter.post(
	'/twilio/amd',
	onTwilioAmdStatusCallback
)

externalWebhookRouter.post(
	'/twilio/transfer/status',
	onTwilioTransferStatusCallback
)

externalWebhookRouter.post(
	'/twilio/customer_profile',
	onTwilioCustomerProfileStatusCallback
)

externalWebhookRouter.post(
	'/twilio/customer_a2p_bundle',
	onTwilioCustomerA2PBundleStatusCallback
)

externalWebhookRouter.post(
	'/twilio/shaken_stir',
	onTwilioShakenStirStatusCallback,
)

externalWebhookRouter.post(
	'/twilio/sink_handler',
	onTwilioA2PCampaignOrBrandStatusCallback,
)

externalWebhookRouter.post(
	'/twilio/cnam/status',
	onTwilioCnamStatus
)

externalWebhookRouter.post(
	'/twilio/sms',
	onTwilioSms
)

externalWebhookRouter.post(
	'/twilio/caller-id-verification',
	onTwilioCallerIdVerification
)

externalWebhookRouter.post(
	'/ghl',
	ghlHandler,
)

externalWebhookRouter.post(
	'/nango',
	nangoWebhook
)
