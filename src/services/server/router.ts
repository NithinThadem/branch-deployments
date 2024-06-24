import { Application, json, urlencoded } from 'express'
import modules from '../../modules'
import {
	adminEditingMiddleware,
	adminMiddleware, adminOrUserMiddleware, authMiddleware, isImpersonatingMiddleware, teamOnlyMiddleware,
} from './middleware/auth.middleware'

const router = (app: Application) => {
	app.use('/webhook', modules.externalWebhookRouter) // no auth, raw body for Stripe

	// Parse JSON and URL-encoded bodies into req.body

	app.use(json({ limit: '2MB' }))
	app.use(urlencoded({ extended: true }))

	// Unauthenticated routes
	app.use('/pubsub', modules.pubsubRouter) // auth middleware TODO
	app.use('/public', modules.publicRouter) // TODO

	app.use(authMiddleware)
	// app.use(rateLimiterMiddleware)
	app.use('/admin', adminMiddleware, modules.adminRouter)

	app.use('/user', modules.userRouter)

	// Only admin users can access admin routes

	// Only team can access the routes
	app.use('/payment', teamOnlyMiddleware, modules.paymentRouter)
	// only allow GET request in impersonate mode
	app.use('/subscription', teamOnlyMiddleware, isImpersonatingMiddleware, modules.subscriptionRouter)

	// Admin or specific user can access these routes
	app.use(adminOrUserMiddleware)
	app.use(adminEditingMiddleware)

	app.use('/interview', modules.interviewRouter)
	app.use('/team', modules.teamRouter)
	app.use('/interview_response', modules.interviewResponseRouter)
	app.use('/interview_deliverable', modules.interviewDeliverableRouter)
	app.use('/contact', modules.contactRouter)
	app.use('/job', modules.jobRouter)
	app.use('/phone_number', modules.phoneNumberRouter)
	app.use('/genius', modules.geniusRouter)
	app.use('/genius_source', modules.geniusSourceRouter)
	app.use('/webhooks', modules.webhookRouter)
	app.use('/api_token', modules.apiTokenRouter)
	app.use('/integration', modules.integrationRouter)
	app.use('/trigger', modules.triggerRouter)
	app.use('/market', modules.marketRouter)
	app.use('/usage', modules.usageRouter)
	app.use('/interview_folder', modules.interviewFolderRouter)
	app.use('/sms_message', modules.smsMessageRouter)
	app.use('/user_team', modules.userTeamRouter)
	app.use('/audit_logs', modules.auditLogRouter)
	app.use('/platform', modules.platformRouter)
	app.use('/caller-id', modules.callerIdRouter)

	// Root & global route
	app.get('*', (_, res) => res.status(404).json({ error: 'Not Found' }))
}

export default router
