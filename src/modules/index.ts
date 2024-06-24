import { interviewFolderRouter } from './interview-folder/api/interview-folder.router'
import { smsMessageRouter } from './sms-message/api/sms-message.router'
import { usageRouter } from './usage/api/usage.router'
import { integrationRouter } from './integration/api/integration.router'
import { geniusRouter } from './genius/api/genius.router'
import { subscriptionRouter } from './subscription/api/subscription.router'
import { phoneNumberRouter } from './phone_number/api/phone_number.router'
import { jobRouter } from './job/api/job.router'
import { contactRouter } from './contact/api/contact.router'
import { interviewDeliverableRouter } from './interview-deliverable/api/interview-deliverable.router'
import { interviewResponseRouter } from './interview-response/api/interview-response.router'
import { teamRouter } from './team/api/team.router'
import { externalWebhookRouter } from './webhook/api/external/external-webhook.router'
import { paymentRouter } from './payment/api/payment.router'
import { interviewRouter } from './interview/api/interview.router'
import { userRouter } from './user/api/user.router'
import { adminRouter } from './admin/admin.router'
import { pubsubRouter } from './pubsub'
import { publicRouter } from './public/api/public.router'
import { geniusSourceRouter } from './genius-source/api/genius-source.router'
import { webhookRouter } from './webhook/api/webhook.router'
import { apiTokenRouter } from './api-token/api/api-token.router'
import { marketRouter } from './market/api/market.router'
import { userTeamRouter } from './user-team/api/user-team.router'
import { auditLogRouter } from './audit-log/api/audit-log.router'
import { triggerRouter } from './trigger/api/trigger.router'
import { platformRouter } from './platform/api/platform.router'
import { callerIdRouter } from './caller-id/api/caller-id.router'

export default {
	userRouter,
	interviewRouter,
	adminRouter,
	pubsubRouter,
	paymentRouter,
	externalWebhookRouter,
	publicRouter,
	teamRouter,
	interviewResponseRouter,
	interviewDeliverableRouter,
	contactRouter,
	jobRouter,
	phoneNumberRouter,
	subscriptionRouter,
	geniusRouter,
	geniusSourceRouter,
	webhookRouter,
	apiTokenRouter,
	integrationRouter,
	triggerRouter,
	marketRouter,
	usageRouter,
	interviewFolderRouter,
	smsMessageRouter,
	userTeamRouter,
	auditLogRouter,
	platformRouter,
	callerIdRouter,
}
