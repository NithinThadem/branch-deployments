import { isProduction } from '../../../util/env.util'
import { TeamEntity } from '../../team/db/team.entity'
import { SubscriptionPlans, SubscriptionStatus } from './subscription.types'
import { SubscriptionEntity } from './subscription.entity'
import { In } from 'typeorm'
import * as moment from 'moment'
import { UsageEntity } from '../../usage/db/usage.entity'
import logger from '../../../util/logger.util'
import { redisRead, redisWrite } from '../../../services/redis'

export const getAllowedMinutesByPlan = (plan: SubscriptionPlans, quantity: number) => {
	switch (plan) {
		case SubscriptionPlans.BASIC:
			return 300
		case SubscriptionPlans.PRO:
			return 1500
		case SubscriptionPlans.BUSINESS:
			return 3000
		// TODO https://linear.app/thoughtlead/issue/MVP-466/pay-as-you-go
		case SubscriptionPlans.AGENCY:
			return 10000
		case SubscriptionPlans.ENTERPRISE_MINUTES:
			return 500 * quantity
		default:
			return 0
	}
}

export type PriceTypes = SubscriptionPlans | 'PHONE_CALL'

export const getPriceId = (plan: PriceTypes): string => {
	switch (plan) {
		case SubscriptionPlans.BASIC:
			return isProduction() ? 'price_1NrmP2JszF4jYEuh9a4KNIrl' : 'price_1NqxrOJszF4jYEuhnscXnj1u'
		case SubscriptionPlans.PRO:
			return isProduction() ? 'price_1OAKarJszF4jYEuhfVpAECE6' : 'price_1Nr49kJszF4jYEuhc5XuhEkl'
		case SubscriptionPlans.BUSINESS:
			return isProduction() ? 'price_1OFI9JJszF4jYEuhtQCBu5Px' : 'price_1OAKajJszF4jYEuhkbUZfUB8'
		case SubscriptionPlans.PHONE_NUMBER:
			return isProduction() ? 'price_1OADBZJszF4jYEuhg1CaZgSY' : 'price_1O9xSCJszF4jYEuhUi7aJLpp'
		case 'PHONE_CALL':
			return isProduction() ? 'price_1OAz8fJszF4jYEuhOqwY56M2' : 'price_1OAz5vJszF4jYEuhjlBir5ET'
		case SubscriptionPlans.AGENCY:
			return isProduction() ? 'price_1OO2GYJszF4jYEuhYegdakiX' : 'price_1OO1TfJszF4jYEuhLUrUAJjj'
		case SubscriptionPlans.ENTERPRISE_MINUTES:
			return isProduction() ? 'price_1OgsgSJszF4jYEuh1Ke8Hk1Z' : 'price_1OgrleJszF4jYEuh5lHVTH8E'
	}
}

export const getPlan = (priceId: string): SubscriptionPlans => {
	const BASIC = getPriceId(SubscriptionPlans.BASIC)
	const PRO = getPriceId(SubscriptionPlans.PRO)
	const BUSINESS = getPriceId(SubscriptionPlans.BUSINESS)
	const PHONE_NUMBER = getPriceId(SubscriptionPlans.PHONE_NUMBER)
	const AGENCY = getPriceId(SubscriptionPlans.AGENCY)
	const ENTERPRISE_MINUTES = getPriceId(SubscriptionPlans.ENTERPRISE_MINUTES)

	switch (priceId) {
		case BASIC: return SubscriptionPlans.BASIC
		case PRO: return SubscriptionPlans.PRO
		case BUSINESS: return SubscriptionPlans.BUSINESS
		case PHONE_NUMBER: return SubscriptionPlans.PHONE_NUMBER
		case AGENCY: return SubscriptionPlans.AGENCY
		case ENTERPRISE_MINUTES: return SubscriptionPlans.ENTERPRISE_MINUTES
	}
}

export const getTeamAllowedMinutes = (team: TeamEntity): number => Math.max(
	10,
	team.subscriptions?.filter((subscription) => subscription.status === SubscriptionStatus.ACTIVE)
		.reduce((acc, subscription) => acc + getAllowedMinutesByPlan(subscription.plan, subscription.quantity), 0) ?? 0,
)

export const getTeamUsedMinutes = async (team: TeamEntity): Promise<number> => {
	if (!team?.id) {
		return 0
	}

	const cache = await redisRead(`team:${team.id}:used_minutes`)

	if (cache) {
		return Math.ceil(Number(cache) / 1000 / 60)
	}

	const subscriptions = team.subscriptions ?
		team.subscriptions.filter((s) => s.status === SubscriptionStatus.ACTIVE) :
		await SubscriptionEntity.find({
			where: {
				team_id: team.id,
				status: SubscriptionStatus.ACTIVE,
			},
		})

	let billingStart = moment().subtract(1, 'month').toDate()

	if (subscriptions.length > 0) {
		for (const subscription of subscriptions) {
			const allowedMinutes = getAllowedMinutesByPlan(subscription.plan, subscription.quantity)

			if (allowedMinutes > 0) {
				billingStart = new Date(subscription.stripe_metadata.current_period_start * 1000)
			}
		}
	}

	const data = await UsageEntity.createQueryBuilder('usage')
		.where('usage.team_id = :teamId', { teamId: team.id })
		.andWhere('usage.created >= :billingStart', { billingStart })
		.select('SUM(usage.quantity_ms)', 'total')
		.getRawOne()

	const millis = data?.total ?? 0

	await redisWrite(
		`team:${team.id}:used_minutes`,
		millis,
		{
			EX: 60,
		}
	)

	logger.debug(`Usage milliseconds for team ${team.id} (billing start: ` +
		`${moment(billingStart).format('MM/DD/YYYY')}): ${millis}`)

	return Math.ceil(millis / 1000 / 60)
}

export const isTeamOverAllowedMinutes = async (team: TeamEntity): Promise<boolean> => {
	if (!team) {
		return true
	}

	const allowed = getTeamAllowedMinutes(team)
	const used = await getTeamUsedMinutes(team)

	return used > allowed
}

export const getTeamBillingPeriodStart = async (team: TeamEntity): Promise<Date | null> => {
	const subscription = await SubscriptionEntity.findOne({
		where: {
			team_id: team.id,
			plan: In([SubscriptionPlans.BASIC, SubscriptionPlans.PRO, SubscriptionPlans.BUSINESS]),
		},
	})

	if (!subscription) { return null }

	return new Date(subscription.stripe_metadata.current_period_start * 1000)
}
