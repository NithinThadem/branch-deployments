/* eslint-disable max-len */
import Stripe from 'stripe'

const stripe = () => new Stripe(process.env.STRIPE_API_KEY, {
	apiVersion: '2023-08-16',
})

export default stripe

export const STRIPE_BASE_URL = process.env.NODE_ENV === 'production' ? 'https://app.thought.ly' :
	process.env.NODE_ENV === 'staging' ? 'https://staging.app.thought.ly' : 'http://localhost:3000'

export const STRIPE_SUCCESS_URL = `${STRIPE_BASE_URL}/settings/subscription`
export const STRIPE_CANCEL_URL = `${STRIPE_BASE_URL}/settings/subscription`
export const STRIPE_RETURN_URL = `${STRIPE_BASE_URL}/settings/subscription`
