/* eslint-disable max-len */
import { ActionData, ActionDetail, CompletionDataResponse } from '../../interview-response/db/interview-response.types'
import { OpenAIModels } from '../../../services/openai'
import { AzureOpenAIModels, azureAi } from '../../../services/azure'
import { getPrompt } from '../../../services/prompts'
import { InterviewFlowEntity } from '../../interview-flow/db/interview-flow.entity'
import { formatTranscript } from '../../interview-response/api/interview-response.helpers'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import { DataPointEntity } from './data-point.entity'
import { DataPoint, DataPointType, DataPointValueType } from './data-point.types'
import { ActionDataDetail, GlobalNodeAnalysis, TotalData } from '../../team/db/team.types'
import { captureError } from '../../../util/error.util'
import { parsePhoneNumber } from 'awesome-phonenumber'
import logger from '../../../util/logger.util'

export const getDataPointsFromInterviewTranscript = async (args: {
	interviewResponse: InterviewResponseEntity
	flow: InterviewFlowEntity
}) => {
	const transcript = formatTranscript(args.interviewResponse)

	const newDataPoints: DataPointEntity[] = []
	const promises = []

	for (const node of args.flow.nodes) {
		const dataPoints = await DataPointEntity.find({
			where: {
				response_id: args.interviewResponse.id,
				type: DataPointType.QUESTION_NODE,
			},
		})

		if (dataPoints.some((dp) => dp.node_id === node.id)) {
			continue
		}

		if (node.data.segment_type === 'question') {
			const question = node.data.description
			const outcomes = node.data.outcomes || []

			const promise = getPrompt.dataFromTranscript({
				question,
				answers: outcomes,
				transcript,
			}).then((content) =>
				azureAi({
					team_id: args.interviewResponse.team_id,
					'Helicone-Property-Feature': 'Data Point',
					'Helicone-Property-InterviewId': args.interviewResponse.interview.id,
					'Helicone-Property-InterviewResponseId': args.interviewResponse.id,
					model: AzureOpenAIModels.GPT_4_O,
				}).chat.completions.create({
					model: OpenAIModels.GPT_4_O,
					messages: [
						{
							role: 'system',
							content,
						},
					],
					tool_choice: {
						type: 'function',
						function: {
							name: 'provide_answer',
						},
					},
					tools: [
						{
							type: 'function',
							function: {
								name: 'provide_answer',
								description: 'Provides an answer to the provided question based on the transcript provided.',
								parameters: {
									type: 'object',
									properties: {
										did_answer: {
											type: 'boolean',
											description: 'If false, the question was never answered in the transcript.',
										},
										answer_strict: {
											type: 'string',
											description: 'The answer to the provided question based on the transcript provided. Only options provided in the enum are allowed exactly as they are provided. If the answer is not in the enum, it is not a valid answer.',
											enum: outcomes.map((outcome) => outcome.trim()),
										},
										answer_other: {
											type: 'string',
											description: 'If the answer is not provided in the enum, this is the answer to the provided question based on the transcript provided. Summarize the answer in as few words as possible to ensure the best results when aggregated with other answers.',
										},
									},
									required: ['did_answer'],
								},
							},
						},
					],
				})
			)

			promises.push(promise.then(({ choices: [{ message: { tool_calls } }] }) => {
				const answer = JSON.parse(tool_calls[0].function.arguments) as {
					did_answer: boolean
					answer_strict?: string
					answer_other?: string
				}

				if (answer.did_answer) {
					let valueType

					if (outcomes.includes(answer.answer_strict)) {
						valueType = DataPointValueType.STRICT
					} else {
						valueType = DataPointValueType.OTHER
					}

					logger.info(`Answered question: ${question} for interview Id: ${args.interviewResponse.interview.id}`)
					newDataPoints.push(DataPointEntity.create({
						response_id: args.interviewResponse.id,
						interview_id: args.interviewResponse.interview.id,
						team_id: args.interviewResponse.team.id,
						response_type: args.interviewResponse.type,
						type: DataPointType.QUESTION_NODE,
						node_id: node.id,
						value: answer.answer_other || answer.answer_strict,
						value_type: valueType,
						metadata: {
							node_data: node.data,
						},
					}))
				}
			}))
		}
	}

	await Promise.all(promises)
	await DataPointEntity.save(newDataPoints)
	await saveCallDataAndActions(args.interviewResponse, args.flow)
	await saveInteractedNodesAsDataPoints(args.interviewResponse, args.flow)
}

export const saveCallDataAndActions = async (interviewResponse: InterviewResponseEntity, flow: InterviewFlowEntity) => {
	const actionsCompleted = interviewResponse.conversation_history
		.filter(item => item.completion_data)
		.map(item => transformCompletionDataToActionData(item.completion_data))
		.filter(action => action != null)
	logger.info(`Saving call data and actions for interview Id: ${interviewResponse.interview.id}`)
	for (const action of actionsCompleted) {
		const actionDataPoint = new DataPointEntity()
		actionDataPoint.created = interviewResponse.created
		actionDataPoint.response_id = interviewResponse.id
		actionDataPoint.interview_id = interviewResponse.interview.id
		actionDataPoint.team_id = interviewResponse.team.id
		actionDataPoint.response_type = interviewResponse.type
		actionDataPoint.type = DataPointType.ACTION_COMPLETED
		actionDataPoint.value = action.action_type
		actionDataPoint.metadata = { actions_completed: [action] }
		await actionDataPoint.save()
	}
}

export const transformCompletionDataToActionData = (completionData: CompletionDataResponse): ActionData | undefined => {
	if (completionData && 'action_detail' in completionData && completionData.action_detail) {
		const action_detail = completionData.action_detail as ActionDetail

		if (action_detail.action_type) {
			return {
				action_type: action_detail.action_type,
				action_details: action_detail,
			}
		}
	}

	return undefined
}

export const saveInteractedNodesAsDataPoints = async (interviewResponse: InterviewResponseEntity, flow: InterviewFlowEntity) => {
	logger.info(`Saving interacted nodes as data points for interview Id: ${interviewResponse.interview.id}`)
	for (const interaction of interviewResponse.conversation_history) {
		if (
			interaction.completion_data &&
			interaction.completion_data.node_id
		) {
			const matchingNode = interviewResponse.interview.flow.nodes.find(node => node.id === interaction.completion_data.node_id)
			if (matchingNode) {
				const nodeCompletedDataPoint = new DataPointEntity()
				nodeCompletedDataPoint.created = interviewResponse.created
				nodeCompletedDataPoint.response_id = interviewResponse.id
				nodeCompletedDataPoint.interview_id = interviewResponse.interview.id
				nodeCompletedDataPoint.team_id = interviewResponse.team.id
				nodeCompletedDataPoint.response_type = interviewResponse.type
				nodeCompletedDataPoint.type = DataPointType.NODE_COMPLETED
				nodeCompletedDataPoint.node_id = matchingNode.id
				nodeCompletedDataPoint.value = matchingNode.data.title
				nodeCompletedDataPoint.metadata = { node_data: matchingNode.data }

				try {
					await nodeCompletedDataPoint.save()
				} catch (error) {
					captureError(error)
				}
			}
		}
	}
}

export const calculateKPIs = (dataPoints, startDate, endDate, interviewId?): TotalData => {
	logger.info(`Calculating KPIs for interview Id: ${interviewId}`)
	const totalDataByType: TotalData = {
		date_range: {
			start_date: startDate instanceof Date ? startDate.toISOString() : null,
			end_date: endDate instanceof Date ? endDate.toISOString() : null,
		},
		total_deployments: 0,
		total_responses: 0,
		total_time_used: 0,
		top_thoughtlys: [],
		call_summary: [],
		global_top_actions: [],
		global_top_node_analysis: [],
		interview: {
			actions_completed: {},
			node_completed_counts: {},
			node_analysis: {},
		},

		BROWSER_TEXT: {
			total_duration: 0,
			total_deployments: 0,
			total_drop_offs: 0,
		},
		BROWSER_CALL: {
			total_duration: 0,
			total_deployments: 0,
			total_drop_offs: 0,
		},
	}
	const thoughtlyAggregates: Record<string, { interview_id: string; duration_ms: number; dataPoints: DataPoint[] }> = {}
	const uniqueInteractions = new Set()
	const uniqueAreaCodesByResponse: { [responseId: string]: Set<number> } = {}
	const uniqueDeploymentsByResponseId = new Set()

	const actionDetails: Map<string, ActionDataDetail> = new Map()
	const nodeDetails: Record<string, { title: string; description: string; answers: Record<string, { count: number; interviewIds: Set<string> }> }> = {}

	dataPoints.forEach(dp => {
		const deploymentType = dp.response_type
		const responseInterviewId = dp.interview_id
		const responseId = dp.response_id

		if (dp.type === DataPointType.ACTION_COMPLETED) {
			const compositeKey = `${dp.value}-${dp.interview_id}`

			if (!actionDetails.has(compositeKey)) {
				actionDetails.set(compositeKey, { count: 0, interview_id: dp.interview_id })
			}

			const actionDetail = actionDetails.get(compositeKey)
			if (actionDetail) {
				actionDetail.count += 1
				actionDetails.set(compositeKey, actionDetail)
			}
		}

		if (dp.type === 'QUESTION_NODE' && dp.value_type === 'STRICT') {
			const nodeId = dp.node_id
			const nodeAnswer = dp.value
			if (!nodeDetails[nodeId]) {
				nodeDetails[nodeId] = { title: dp.metadata.node_data.title, description: dp.metadata.node_data.description, answers: {} }
			}
			if (!nodeDetails[nodeId].answers[nodeAnswer]) {
				nodeDetails[nodeId].answers[nodeAnswer] = { count: 0, interviewIds: new Set<string>() }
			}
			nodeDetails[nodeId].answers[nodeAnswer].count += 1
			nodeDetails[nodeId].answers[nodeAnswer].interviewIds.add(dp.interview_id)
		}

		const sortedActionDetails = Array.from(actionDetails)
			.map(([compositeKey, detail]) => ({
				action: compositeKey.split('-')[0],
				count: detail.count,
				interview_id: detail.interview_id,
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10)

		const allAnswers = Object.entries(nodeDetails).flatMap(([nodeId, nodeData]) => Object.entries(nodeData.answers).map(([answer, detail]) => ({
			node_id: nodeId,
			title: nodeData.title,
			description: nodeData.description,
			answer: answer,
			count: detail.count,
			interviewIds: Array.from(detail.interviewIds),
		})))

		const topAnswers = allAnswers.sort((a, b) => b.count - a.count).slice(0, 10)

		const topNodeAnalysis = topAnswers.reduce((acc, ans) => {
			if (!acc[ans.node_id]) {
				acc[ans.node_id] = {
					node_id: ans.node_id,
					title: ans.title,
					description: ans.description,
					answers: [],
					interview_id: ans.interviewIds[0],
				}
			}
			acc[ans.node_id].answers.push({
				answer: ans.answer,
				count: ans.count,
				interviewIds: ans.interviewIds,
			})
			return acc
		}, {})

		Object.values(topNodeAnalysis).forEach((node: GlobalNodeAnalysis) => {
			node.answers.sort((a, b) => b.count - a.count)
		})

		const sortedGlobalNodeAnalysis: GlobalNodeAnalysis[] = Object.values(topNodeAnalysis)

		totalDataByType.global_top_actions = sortedActionDetails
		totalDataByType.global_top_node_analysis = sortedGlobalNodeAnalysis

		if (!thoughtlyAggregates[responseInterviewId]) {
			thoughtlyAggregates[responseInterviewId] = {
				interview_id: responseInterviewId,
				duration_ms: 0,
				dataPoints: [],
			}
		}

		thoughtlyAggregates[responseInterviewId].dataPoints.push(dp)

		const deploymentIdentifier = `${responseId}_${deploymentType}`
		if (uniqueDeploymentsByResponseId.has(deploymentIdentifier)) {
			return
		} else {
			uniqueDeploymentsByResponseId.add(deploymentIdentifier)
		}

		if (!(deploymentType in totalDataByType)) {
			totalDataByType[deploymentType] = {
				total_duration: 0,
				total_deployments: 0,
				total_drop_offs: 0,
				...(deploymentType === 'PHONE_CALL' && { total_voicemails: 0, total_no_answers: 0 }),
			}
		}

		if (dp.type === 'THOUGHTLY_END_DATA') {
			const endData = dp.metadata?.thoughtly_end

			const interactionIdentifier = `${deploymentType}_${responseInterviewId}_${endData.start_time}`
			if (!uniqueInteractions.has(interactionIdentifier)) {
				uniqueInteractions.add(interactionIdentifier)
				totalDataByType[deploymentType].total_duration += parseFloat(endData.duration)
				totalDataByType[deploymentType].total_deployments += 1

				if (deploymentType === 'PHONE_CALL') {
					if (dp.type === DataPointType.NO_ANSWER && 'total_no_answers' in totalDataByType[deploymentType]) {
						totalDataByType[deploymentType].total_no_answers++
					}
					if (dp.type === DataPointType.VOICEMAIL && 'total_voicemails' in totalDataByType[deploymentType]) {
						totalDataByType[deploymentType].total_voicemails++
					}
				}
				totalDataByType.total_deployments += 1
				totalDataByType.total_time_used += parseFloat(endData.duration)
				if (![DataPointType.VOICEMAIL, DataPointType.NO_ANSWER].includes(dp.type)) {
					totalDataByType.total_responses += 1
				}
			}

			if (endData && endData.user_ended) {
				totalDataByType[deploymentType].total_drop_offs++
			}
			if (endData && endData.phone_number) {
				const responseId = dp.response_id
				// get the international area code
				const phoneNumber = parsePhoneNumber(dp.metadata.thoughtly_end.phone_number)
				if (phoneNumber.valid) {
					if (phoneNumber.regionCode === 'US') {
						const areaCodeStr = phoneNumber.number.national.substring(1, 4)
						const areaCode = parseInt(areaCodeStr, 10)

						if (!isNaN(areaCode)) {
							if (!uniqueAreaCodesByResponse[responseId]) {
								uniqueAreaCodesByResponse[responseId] = new Set<number>()
							}

							if (!uniqueAreaCodesByResponse[responseId].has(areaCode)) {
								uniqueAreaCodesByResponse[responseId].add(areaCode)

								const index = totalDataByType.call_summary.findIndex(summary => summary.regionCode === 'US')
								if (index !== -1) {
									totalDataByType.call_summary[index].count++
									totalDataByType.call_summary[index].areaCodes[areaCode] = totalDataByType.call_summary[index].areaCodes[areaCode] + 1 || 1
								} else {
									totalDataByType.call_summary.push({ regionCode: 'US', areaCodes: { [areaCode]: 1 }, count: 1 })
								}
							}
						}
					} else {
						const index = totalDataByType.call_summary.findIndex(summary => summary.regionCode === phoneNumber.regionCode)
						if (index !== -1) {
							totalDataByType.call_summary[index].count++
						} else {
							totalDataByType.call_summary.push({ regionCode: phoneNumber.regionCode, count: 1 })
						}
					}
				}
			}

			if (responseInterviewId) {
				const duration_ms = parseFloat(dp.metadata.thoughtly_end.duration)

				if (!thoughtlyAggregates[responseInterviewId]) {
					thoughtlyAggregates[responseInterviewId] = {
						interview_id: responseInterviewId,
						duration_ms: 0,
						dataPoints: [],
					}
				}

				thoughtlyAggregates[responseInterviewId].duration_ms += duration_ms
				thoughtlyAggregates[responseInterviewId].dataPoints.push(dp)
			}
		}

		if (interviewId && dp.interview?.id === interviewId) {
			processInterviewData(dp, totalDataByType.interview)
		}
	})

	const topThoughtlys = Object.values(thoughtlyAggregates)
		.sort((a, b) => b.duration_ms - a.duration_ms)
		.map(thoughtly => ({
			interview_id: thoughtly.interview_id,
			duration_ms: thoughtly.duration_ms,
			interview: {
				actions_completed: {},
				node_completed_counts: {},
				node_analysis: {},
				total_time_used: thoughtly.duration_ms,
			},
		}))

	topThoughtlys.forEach(thoughtly => {
		thoughtlyAggregates[thoughtly.interview_id].dataPoints.forEach(dp => {
			processInterviewData(dp, thoughtly.interview)
		})
	})

	totalDataByType.top_thoughtlys = topThoughtlys

	if (totalDataByType.BROWSER_TEXT) {
		delete totalDataByType.BROWSER_TEXT.total_voicemails
		delete totalDataByType.BROWSER_TEXT.total_drop_offs
		delete totalDataByType.BROWSER_TEXT.total_no_answers
	}
	if (totalDataByType.BROWSER_CALL) {
		delete totalDataByType.BROWSER_CALL.total_voicemails
		delete totalDataByType.BROWSER_CALL.total_drop_offs
		delete totalDataByType.BROWSER_CALL.total_no_answers
	}
	if (!interviewId) {
		delete totalDataByType.interview
	}
	if (interviewId) {
		delete totalDataByType.top_thoughtlys
	}
	return totalDataByType
}

function processInterviewData(dp, interviewData) {
	interviewData.actions_completed = interviewData.actions_completed || {}
	interviewData.node_completed_counts = interviewData.node_completed_counts || {}
	interviewData.node_analysis = interviewData.node_analysis || {}

	if (dp.type === DataPointType.ACTION_COMPLETED) {
		const actionType = dp.value
		interviewData.actions_completed[actionType] = (interviewData.actions_completed[actionType] || 0) + 1
	}

	if (dp.type === 'QUESTION_NODE' && dp.value_type === 'STRICT') {
		const nodeId = dp.node_id
		const nodeAnswer = dp.value

		if (!interviewData.node_analysis[nodeId]) {
			interviewData.node_analysis[nodeId] = { title: '', description: '', strict_answers: {} }
		}

		const nodeData = dp.metadata?.node_data
		if (nodeData && nodeData.description) {
			interviewData.node_analysis[nodeId].title = nodeData.title || ''
			interviewData.node_analysis[nodeId].description = nodeData.description

			interviewData.node_analysis[nodeId].strict_answers[nodeAnswer] =
				(interviewData.node_analysis[nodeId].strict_answers[nodeAnswer] || 0) + 1
		}
	}

	if (dp.type === 'NODE_COMPLETED') {
		const nodeId = dp.node_id
		interviewData.node_completed_counts[nodeId] = (interviewData.node_completed_counts[nodeId] || 0) + 1
	}
}
