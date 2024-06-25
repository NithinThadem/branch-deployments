/* eslint-disable max-len */
import { AuthenticatedRequest } from '../../../types'
import { Response } from 'express'
import response from '../../../services/server/response'
import * as moment from 'moment'
import dataSource from '../../../services/database/data-source'
import { stringify } from 'csv-stringify'
import { UsageEntity } from '../db/usage.entity'
import { SubscriptionPlans, SubscriptionStatus } from '../../subscription/db/subscription.types'
import { captureError } from '../../../util/error.util'

export const getUsage = async (req: AuthenticatedRequest, res: Response) => {
	const timeFrame = req.query.time_frame || 'month'
	const billingEnd = moment().toDate()
	const billingStart = moment(billingEnd)

	switch (timeFrame) {
		case 'day':
			billingStart.subtract(1, 'days')
			break
		case 'week':
			billingStart.subtract(1, 'weeks')
			break
		case 'month':
			billingStart.subtract(1, 'months')
			break
	}

	const queryParams = [billingStart.toDate(), req.headers.team_id]
	const whereConditions = 'created >= $1 AND team_id = $2'

	const rawQuery = `
        WITH usage_summary AS (
        SELECT
            DATE(created) AS usage_date,
            SUM(quantity_ms) FILTER (WHERE type IS NOT NULL) AS total_quantity_ms,
            type,
            interview_id
        FROM
            usage
        WHERE
            ${whereConditions}
        GROUP BY
            DATE(created), ROLLUP(type, interview_id)
        )
        SELECT
            usage_date,
            'Total Usage' AS description,
            SUM(total_quantity_ms) AS total_quantity_ms
        FROM
            usage_summary
        WHERE
            type IS NULL AND interview_id IS NULL
        GROUP BY
            usage_date
        UNION ALL
        SELECT
            usage_date,
            'Usage By Type: ' || type AS description,
            SUM(total_quantity_ms) AS total_quantity_ms
        FROM
        usage_summary
        WHERE
            type IS NOT NULL AND interview_id IS NULL
        GROUP BY
            usage_date, type
        UNION ALL
        SELECT
            usage_date,
            'Usage By Interview ID: ' || interview_id AS description,
            SUM(total_quantity_ms) AS total_quantity_ms
        FROM
            usage_summary
        WHERE
            interview_id IS NOT NULL
        GROUP BY
            usage_date, interview_id
				UNION ALL
				SELECT
						u.usage_date,
						'Usage By Folder: ' || f.name AS description,
						SUM(u.total_quantity_ms) AS total_quantity_ms
				FROM
						(
								SELECT
										DATE(created) AS usage_date,
										SUM(quantity_ms) AS total_quantity_ms,
										interview_id
								FROM
										usage
								WHERE
										${whereConditions}
								GROUP BY
										DATE(created), interview_id
						) AS u
				JOIN
						interview i ON u.interview_id = i.id
				JOIN
						interview_folder f ON i.folder_id = f.id
				GROUP BY
						u.usage_date, f.name;
    `

	const rawData = await dataSource.query(rawQuery, queryParams)

	const dailyUsage = {}

	rawData.forEach(async (item) => {
		const date = item.usage_date
		if (!dailyUsage[date]) {
			dailyUsage[date] = {
				total: 0,
				by_type: {},
				by_interview: {},
				by_folder: {},
			}
		}

		if (item.description === 'Total Usage') {
			dailyUsage[date].total = parseFloat(item.total_quantity_ms)
		} else if (item.description.startsWith('Usage By Type: ')) {
			const type = item.description.replace('Usage By Type: ', '')
			dailyUsage[date].by_type[type] = parseFloat(item.total_quantity_ms)
		} else if (item.description.startsWith('Usage By Interview ID: ')) {
			const interviewId = item.description.replace('Usage By Interview ID: ', '')
			dailyUsage[date].by_interview[interviewId] = parseFloat(item.total_quantity_ms)
		} else if (item.description.startsWith('Usage By Folder: ')) {
			const folderName = item.description.replace('Usage By Folder: ', '')
			dailyUsage[date].by_folder[folderName] = (dailyUsage[date].by_folder[folderName] ?? 0) + parseFloat(item.total_quantity_ms)
		}
	})

	const responseData = Object.keys(dailyUsage).map(date => ({
		date,
		...dailyUsage[date],
	}))

	return response({
		res,
		data: {
			start: billingStart,
			usage: responseData,
		},
	})
}

export const exportUsageToCSV = async (req: AuthenticatedRequest, res: Response) => {
	let columns = {
		thoughtly_id: 'Thoughtly ID',
		thoughtly_name: 'Thoughtly Name',
		type: 'Usage Type',
		quantity_ms: 'Used for Seconds',
		runs: 'Deployed Times',
	} as any

	const msToSeconds = (ms?: number) => ms ? Math.floor(ms / 1000) : 0

	const _usages = await UsageEntity.find({
		where: {
			team_id: req.headers.team_id,
		},
		relations: ['interview', 'interview.folder', 'interview.responses', 'interview.team'],
	})

	const usages = _usages.map(u => {
		const data = {
			thoughtly_id: u.interview.id,
			quantity_ms: msToSeconds(u.quantity_ms),
			thoughtly_name: u.interview.title,
			type: u.type.toString(),
			runs: u.interview.responses.length || 0,
		}

		if (u.interview.folder && u.interview.team.subscriptions?.some(sub => sub.plan === SubscriptionPlans.AGENCY && sub.status === SubscriptionStatus.ACTIVE)) {
			columns = {
				...columns,
				folder: 'Folder Name',
			}

			return {
				...data,
				folder: u.interview.folder.name,
			}
		}

		return data
	})

	const outputFilename = 'usage_report.csv'

	stringify(usages, { header: true, delimiter: ',', columns }, (err, out) => {
		if (err) {
			captureError(err)
			return response({ res, status: 500, error: 'Something went wrong' })
		}

		res.setHeader('Content-Type', 'text/csv')
		res.setHeader('Content-Disposition', `attachment; filename=${outputFilename}`)
		res.status(200).send(out)
	})
}
