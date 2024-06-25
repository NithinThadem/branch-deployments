// eslint-disable-next-line spaced-comment
/// <reference types="stripe-event-types" />
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../../types'
import stripe from '../../../../services/stripe'
import response from '../../../../services/server/response'
import logger from '../../../../util/logger.util'
import { SubscriptionEntity } from '../../../subscription/db/subscription.entity'
import Stripe from 'stripe'
import { SubscriptionStatus } from '../../../subscription/db/subscription.types'
import { PaymentEntity } from '../../../payment/db/payment.entity'
import { PaymentStatus } from '../../../payment/db/payment.types'
import { InvoiceEntity } from '../../../invoice/db/invoice.entity'
import { InvoiceStatus } from '../../../invoice/db/invoice.types'
import { TeamEntity } from '../../../team/db/team.entity'
import EventUtil from '../../../../services/event'
import { getPlan } from '../../../subscription/db/subscription.helpers'

const upsertCustomer = async (customer: Stripe.Customer) => {
	const team = await TeamEntity.findOneOrFail({
		where: {
			stripe_customer_id: customer.id,
		},
	})

	team.stripe_metadata = customer
	await team.save()
}

const upsertInvoice = async (invoice: Stripe.Invoice, eventName: string) => {
	const subscription = await SubscriptionEntity.findOneBy({
		stripe_subscription_id: invoice.subscription as string,
	})

	const team = await TeamEntity.findOneByOrFail({
		stripe_customer_id: invoice.customer as string,
	})

	if (
		invoice.subscription_details.metadata.phone_number &&
		eventName === 'invoice.payment_succeeded'
	) {
		await EventUtil.asyncEmit('PHONE_NUMBER_PURCHASED', {
			phone_number: invoice.subscription_details.metadata.phone_number,
			subscription_id: invoice.subscription as string,
		})
	}

	return InvoiceEntity.upsert([{
		subscription,
		team,
		amount: invoice.total / 100,
		invoice_date: new Date(invoice.created * 1000),
		status: invoice.status as InvoiceStatus,
		stripe_invoice_id: invoice.id,
		stripe_metadata: invoice,
	}], {
		conflictPaths: ['stripe_invoice_id'],
		skipUpdateIfNoValuesChanged: true,
	})
}

const upsertPayment = async (payment: Stripe.PaymentIntent) => {
	const invoice = await InvoiceEntity.findOneByOrFail({
		stripe_invoice_id: payment.invoice as string,
	})

	const team = await TeamEntity.findOneByOrFail({
		stripe_customer_id: payment.customer as string,
	})

	return PaymentEntity.upsert([{
		invoice,
		team,
		amount: payment.amount / 100,
		payment_date: new Date(payment.created * 1000),
		status: payment.status as PaymentStatus,
		stripe_payment_id: payment.id,
		stripe_metadata: payment,
	}], {
		conflictPaths: ['stripe_payment_id'],
		skipUpdateIfNoValuesChanged: true,
	})
}

const onPaymentSucceeded = async (payment: Stripe.PaymentIntent) =>
	upsertPayment(payment)

const upsertSubscription = async (subscription: Stripe.Subscription) => {
	const team = await TeamEntity.findOneByOrFail({
		stripe_customer_id: subscription.customer as string,
	})

	return SubscriptionEntity.upsert([{
		team,
		stripe_subscription_id: subscription.id,
		start_date: new Date(subscription.current_period_start * 1000),
		status: subscription.status as SubscriptionStatus,
		stripe_metadata: subscription,
		plan: getPlan(subscription.items.data[0].price.id),
		quantity: subscription.items.data[0].quantity,
	}], {
		conflictPaths: ['stripe_subscription_id'],
		skipUpdateIfNoValuesChanged: true,
	})
}

const onSubscriptionCreated = async (subscription: Stripe.Subscription) => {
	await upsertSubscription(subscription)
}

const onSubscriptionCancelled = async (subscription: Stripe.Subscription) => {
	await upsertSubscription(subscription)

	if (subscription.metadata.phone_number) {
		await EventUtil.asyncEmit('PHONE_NUMBER_CANCELLED', {
			phone_number: subscription.metadata.phone_number,
			subscription_id: subscription.id,
		})
	}
}

const eventHandlers: Partial<{ [k in Stripe.DiscriminatedEvent.Type]: (data: any, eventName: string) => Promise<any> }> = {

	// Customer subscription

	'customer.subscription.trial_will_end': upsertSubscription,
	'customer.subscription.deleted': onSubscriptionCancelled,
	'customer.subscription.created': onSubscriptionCreated,
	'customer.subscription.updated': upsertSubscription,
	'customer.subscription.paused': upsertSubscription,
	'customer.subscription.pending_update_applied': upsertSubscription,
	'customer.subscription.pending_update_expired': upsertSubscription,
	'customer.subscription.resumed': upsertSubscription,

	// Invoice

	'invoice.created': upsertInvoice,
	'invoice.updated': upsertInvoice,
	'invoice.paid': upsertInvoice,
	'invoice.payment_succeeded': upsertInvoice,
	'invoice.finalized': upsertInvoice,
	'invoice.finalization_failed': upsertInvoice,
	'invoice.voided': upsertInvoice,
	'invoice.deleted': upsertInvoice,
	'invoice.sent': upsertInvoice,
	'invoice.upcoming': upsertInvoice,
	'invoice.payment_failed': upsertInvoice,
	'invoice.marked_uncollectible': upsertInvoice,
	'invoice.payment_action_required': upsertInvoice,

	// Payment intent

	'payment_intent.succeeded': onPaymentSucceeded,
	'payment_intent.created': upsertPayment,
	'payment_intent.payment_failed': upsertPayment,
	'payment_intent.canceled': upsertPayment,
	'payment_intent.processing': upsertPayment,
	'payment_intent.amount_capturable_updated': upsertPayment,
	'payment_intent.requires_action': upsertPayment,
	'payment_intent.partially_funded': upsertPayment,

	// Customer

	'customer.created': upsertCustomer,
	'customer.updated': upsertCustomer,
}

export const stripeWebhookHandler = async (req: AuthenticatedRequest, res: Response) => {
	let event: Stripe.DiscriminatedEvent = req.body
	try {
		event = stripe().webhooks.constructEvent(
			req.body,
			req.headers['stripe-signature'],
			process.env.STRIPE_WEBHOOK_SECRET
		) as Stripe.DiscriminatedEvent
	} catch (err) {
		logger.error(`⚠️  Webhook signature verification failed. ${err.message}`)
		return response({ res, status: 400, data: { error: err.message } })
	}

	logger.debug(`🔔  Stripe webhook received: ${event.type}`)
	const handler = eventHandlers[event.type]

	if (handler) {
		await handler(event.data.object, event.type)
	} else {
		logger.warn(`Unhandled event type ${event.type}.`)
	}

	return response({ res })
}
