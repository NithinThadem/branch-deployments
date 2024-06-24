/* eslint-disable max-len */
import { Socket } from 'socket.io'
import { captureError } from '../../../util/error.util'
import { InterviewFlowEntity } from '../../interview-flow/db/interview-flow.entity'
import { InterviewEntity } from '../db/interview.entity'
import logger from '../../../util/logger.util'
import dataSource from '../../../services/database/data-source'
import {
	InterviewEdge, InterviewFunction, InterviewFunctionName, InterviewNode, KeyValue,
} from '../../interview-flow/db/interview-flow.types'
import { getMessagesForPineconeQuery, getPineconeIndex, queryPinecone } from '../../genius/db/genius.helpers'
import { ConversationHistory, InterviewResponseType } from '../../interview-response/db/interview-response.types'
import { Index } from '@pinecone-database/pinecone'
import {
	getMessagesForCompletion, sanitizeText, chatCompletionIterator, getDataPointsForNode,
	getStepNumber,
	getLastUserMessages,
} from '../../public/api/public.helpers'
import { generateInitialConversationHistory } from '../../interview-response/api/interview-response.helpers'
import { withExponentialBackoff } from '../../../util/helpers.util'
import {
	handleCompletionDataResponse,
	handleSecondaryActions,
	makeApiCall,
	transformFunctionsToParams,
	transformScriptToMermaid,
} from '../../interview-flow/db/interview-flow.helpers'
import { v4 } from 'uuid'
import { redisRead, redisWrite } from '../../../services/redis'
import * as _ from 'lodash'
import { saveUsageForPreview } from '../../usage/db/usage.helpers'
import { OpenAIModels } from '../../../services/openai'
import { azureAi, AzureOpenAIModels } from '../../../services/azure'
export const onInterviewSocket = async (socket: Socket) => {
	const interviewId: string = socket.handshake.query.interview_id as string
	const name = socket.handshake.query.name || 'Anonymous'

	if (typeof socket.handshake.query.interview_id !== 'string') {
		throw new Error('Interview ID is not a string')
	}

	const session_id: string = v4()
	socket.emit('session_id', session_id)

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	socket.join(`interview-${interviewId}`)

	socket.on('cursor', (data: { x: number, y: number }) => {
		socket.to(`interview-${interviewId}`).emit('cursor', {
			...data,
			name,
			session_id,
		})
	})

	// Flow state batch updates

	let batchUpdateData = {
		createNodes: new Map() as Map<string, InterviewNode & { timestamp: number }>,
		updateNodes: new Map() as Map<string, InterviewNode & { timestamp: number }>,
		deleteNodeIds: new Set() as Set<string>,
		createEdges: new Map() as Map<string, InterviewEdge & { timestamp: number }>,
		updateEdges: new Map() as Map<string, InterviewEdge & { timestamp: number }>,
		deleteEdgeIds: new Set() as Set<string>,
	}

	let batchUpdateTimer

	function addOrUpdateItem(map, item, timestamp) {
		const existing = map.get(item.id)
		if (!existing || timestamp > existing.timestamp) {
			map.set(item.id, { ...item, timestamp })
		}
	}

	function scheduleBatchUpdate() {
		const debounceDelay = 250

		clearTimeout(batchUpdateTimer)
		batchUpdateTimer = setTimeout(async () => {
			try {
				const batchData = {
					createNodes: Array.from(batchUpdateData.createNodes.values()),
					updateNodes: Array.from(batchUpdateData.updateNodes.values()),
					deleteNodeIds: Array.from(batchUpdateData.deleteNodeIds),
					createEdges: Array.from(batchUpdateData.createEdges.values()),
					updateEdges: Array.from(batchUpdateData.updateEdges.values()),
					deleteEdgeIds: Array.from(batchUpdateData.deleteEdgeIds),
				}
				logger.debug(`Saving flow for interview ${interviewId}`)
				await InterviewFlowEntity.batchUpdate(interviewId, batchData)

				// Reset batch data
				batchUpdateData = {
					createNodes: new Map(),
					updateNodes: new Map(),
					deleteNodeIds: new Set(),
					createEdges: new Map(),
					updateEdges: new Map(),
					deleteEdgeIds: new Set(),
				}
			} catch (error) {
				_onError(error)
			}
		}, debounceDelay)
	}

	// Node Handlers

	socket.on('create_node', (node: InterviewNode) => {
		addOrUpdateItem(batchUpdateData.createNodes, node, Date.now())
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('create_node', node)
	})

	socket.on('update_node', (node: InterviewNode) => {
		addOrUpdateItem(batchUpdateData.updateNodes, node, Date.now())
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('update_node', node)
	})

	socket.on('delete_node', (nodeId: string) => {
		batchUpdateData.deleteNodeIds.add(nodeId)
		batchUpdateData.createNodes.delete(nodeId)
		batchUpdateData.updateNodes.delete(nodeId)
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('delete_node', nodeId)
	})

	// Edge Handlers

	socket.on('create_edge', (edge: InterviewEdge) => {
		addOrUpdateItem(batchUpdateData.createEdges, edge, Date.now())
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('create_edge', edge)
	})

	socket.on('update_edge', (edge: InterviewEdge) => {
		addOrUpdateItem(batchUpdateData.updateEdges, edge, Date.now())
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('update_edge', edge)
	})

	socket.on('delete_edge', (edgeId: string) => {
		batchUpdateData.deleteEdgeIds.add(edgeId)
		batchUpdateData.createEdges.delete(edgeId)
		batchUpdateData.updateEdges.delete(edgeId)
		scheduleBatchUpdate()
		socket.to(`interview-${interviewId}`).emit('delete_edge', edgeId)
	})

	// Functions and Interview state

	socket.on('update_functions', async (data: InterviewFunction[]) => {
		try {
			logger.debug(`Updating functions for interview ${interviewId}`)
			await InterviewFlowEntity.updateFunctions(interviewId, data)
			socket.to(`interview-${interviewId}`).emit('update_functions', {
				data,
				author: session_id,
			})
		} catch (error) {
			_onError(error)
		}
	})

	socket.on('update_interview', async (data) => {
		try {
			logger.debug(`Updating interview ${interviewId}`)
			await dataSource.createQueryBuilder()
				.update(InterviewEntity)
				.set({
					title: data.title,
					type: data.type,
					ai_name: data.ai_name,
					genius_id: data.genius_id,
					lang: data.lang,
					response_tags: data.response_tags,
					notifications: data.notifications,
					presence_background_audio: data.presence_background_audio,
					presence_interim_audio: data.presence_interim_audio,
					personality_customization: data.personality_customization,
					should_record: data.should_record,
					should_leave_voicemail: data.should_leave_voicemail,
					voicemail_message: data.voicemail_message,
				})
				.where('id = :id', { id: interviewId })
				.execute()
				.catch(_onError)
			socket.to(`interview-${interviewId}`).emit('update_interview', {
				data,
				author: session_id,
			})
		} catch (error) {
			_onError(error)
		}
	})

	// API test to allow the user to map the response and utilize it in the flow
	socket.on('test_api_call', async (data: { matchingNode: InterviewNode, query: KeyValue[], headers: KeyValue[], body: KeyValue[], url: string }) => {
		try {
			logger.debug(`Received API test request for node ${data.matchingNode.id}`)

			const headers = data.headers || []
			const query = data.query || []
			const body = data.body || []

			const sanitizedHeaders = headers.reduce((acc, { key, value }) => {
				acc[key] = value.value
				return acc
			}, {} as Record<string, string>)

			const sanitizedQuery = query.reduce((acc, { key, value }) => {
				acc[key] = value.value
				return acc
			}, {} as Record<string, string>)

			const sanitizedBody = body.reduce((acc, { key, value }) => {
				acc[key] = value.value
				return acc
			}, {} as Record<string, string>)

			const apiResponse = await makeApiCall(
				data.matchingNode,
				null,
				sanitizedQuery,
				sanitizedHeaders,
				sanitizedBody,
				data.url,
			)

			socket.emit('api_response', apiResponse)
			logger.debug(`Updated node ${data.matchingNode.id} with API response`)
		} catch (error) {
			_onError(error)
		}
	})

	socket.on('disconnect', async () => {
		logger.debug(`Interview socket disconnected: ${socket.handshake.query.interview_id}`)

		await redisWrite(
			`interview-${interviewId}-users`,
			JSON.stringify(
				_.uniq(
					JSON.parse(
						await redisRead(`interview-${interviewId}-users`)
					)
				).filter(user => user !== name)
			),
			{
				EX: 60 * 60, // 1 hour
			}
		)
	})

	// Load initial data

	await Promise.all([
		(async () => {
			const interview = await InterviewEntity.findOneOrFail({
				where: {
					id: interviewId,
				},
				relations: ['flow'],
			})

			if (!interview?.flow) {
				logger.info(`Creating flow for interview ${interviewId}`)
				interview.flow = InterviewFlowEntity.createFlowFromType(interviewId, interview.type)
				await interview.save()
			}

			socket.emit('init', { flow: interview.flow })
		})(),
		(async () => {
			const existing = await redisRead(`interview-${interviewId}-users`)
			const users = existing ? JSON.parse(existing) : []
			await redisWrite(
				`interview-${interviewId}-users`,
				JSON.stringify(
					_.uniq([...users, name])
				),
				{
					EX: 60 * 60, // 1 hour
				}
			)
		})(),
	])
}

export const onInterviewTestSocket = async (socket: Socket) => {
	let interview: InterviewEntity = null
	let pineconeIndex: Index = null
	let conversationHistory: ConversationHistory[] = []
	let interimAnalysis = null
	let lastCompletedNode: InterviewNode
	let answer: string
	const secondaryActionOutputs = []

	const blankValueTracker: { nodeId: string; value: string }[] = []

	const _onError = (error: any) => {
		socket.emit('error', error)
		captureError(error)
	}

	/*
	 lastCompletedNode
	 -> message
	 matchedNode (new completion)
	 */

	socket.on('message', async (message: string) => {
		try {
			if (!interview) {
				throw new Error('Interview response not found')
			}

			// If no last completed node, default to the first node
			if (interview && interview.flow && interview.flow.nodes && interview.flow.nodes.length > 0 && !lastCompletedNode) {
				const startNode = interview.flow.nodes.find(node => node.data && node.data.type === 'start')

				lastCompletedNode = startNode
			}

			conversationHistory.push({
				author: 'user',
				text: message,
				date: new Date(),
			})

			let vectorResponse

			if (pineconeIndex) {
				vectorResponse = await queryPinecone(
					getMessagesForPineconeQuery(conversationHistory),
					pineconeIndex,
					6,
				)
			}

			// Generate the answer for the last node based on the user's response if it's not an API call
			if (lastCompletedNode && lastCompletedNode.id && String(lastCompletedNode.data?.function) !== InterviewFunctionName.API_CALL) {
				// LLM call to get the answer
				answer = await getDataPointsForNode({
					node: lastCompletedNode,
					userAnswer: message,
					interviewId: interview.id,
					responseId: 'preview',
				})

				// Find the entry in the blank value tracker that corresponds to the last completed node
				const trackerEntry = blankValueTracker.find(entry => entry.nodeId === lastCompletedNode.id)

				if (trackerEntry) {
					// Update the value if it's already in the tracker
					trackerEntry.value = answer
				} else {
					// Add a new entry if it's not in the tracker
					blankValueTracker.push({ nodeId: lastCompletedNode.id, value: answer })
				}

				await handleSecondaryActions({
					nodes: interview.flow.nodes,
					edges: interview.flow.edges,
					contact: null,
					blankValueTracker,
					lastCompletedNode,
					userAnswer: message,
					secondaryActionOutputs,
					interviewId: interview.id,
					responseId: 'preview',
				})
			} else {
				logger.warn('Last completed node is not found or is an API call, skipping LLM call')
			}

			// Construct the mermaid graph with updated values held in the value tracker
			const { labelToNodeIdMap, mermaidGraph } = transformScriptToMermaid({
				nodes: interview.flow.nodes,
				edges: interview.flow.edges,
				fn_params: transformFunctionsToParams(interview.flow.functions),
				blankValueTracker,
				lang: interview.lang,
			})

			// Call `chatCompletionIterator` with exponential backoff
			// to get a completion promise, used to get the completion data
			// and a stepPromise, used to get the step number
			const [completionPromise] = await withExponentialBackoff(
				() => chatCompletionIterator({
					messages: getMessagesForCompletion({
						vectorResponse,
						conversation_history: conversationHistory,
					}),
					timeoutMs: 10000,
					interimAnalysis,
					interviewId: interview.id,
					script: mermaidGraph,
					teamId: interview.team_id,
					responseId: 'preview',
					secondaryActionOutputs,
				})
			)
			interimAnalysis = null

			// Stream AI response to the client
			let fullResponse = ''
			const completion = await completionPromise
			for await (const aiText of completion) {
				fullResponse += aiText
				socket.emit('interim_message', sanitizeText(fullResponse))
			}

			// Await step data promise
			const data = await getStepNumber(getLastUserMessages(conversationHistory), fullResponse, mermaidGraph, interview.id, interview.flow.edges)

			// Get the step number from the completion data
			// and map it to a node ID -> node
			let nodeId = lastCompletedNode.id
			if (data !== -1) {
				nodeId = labelToNodeIdMap[data]
			}
			const matchingNode = interview.flow.nodes.find(node => node.id === nodeId)

			// Push the full response to the conversation history and emit it
			conversationHistory.push({
				author: 'ai',
				text: fullResponse,
				date: new Date(),
				completion_data: { node_id: matchingNode.id || '' },
			})
			socket.emit('data', conversationHistory)

			const { _shouldTransferAgentTo } = await handleCompletionDataResponse({
				matchingNode,
			})

			if (_shouldTransferAgentTo) {
				interview = await InterviewEntity.findOneOrFail({
					where: { id: _shouldTransferAgentTo },
					relations: ['flow', 'team'],
				})

				const newConversationHistory = await generateInitialConversationHistory({
					interview: interview,
					type: InterviewResponseType.BROWSER_TEXT,
				})

				const messagesContent = [
					JSON.stringify(conversationHistory, null, 2),
					'**Prompt***\n\nWhat index represents the AI\'s last response? Whichever Say message matches the closest will be the index to choose.\n\n**Prompt***',
				]

				const prompt = messagesContent.join('\n\n')

				const { choices } = await azureAi({
					'Helicone-Property-Feature': 'Agent Transfer Summary (Test)',
					'Helicone-Property-InterviewId': interview.id,
					team_id: interview.team_id,
					model: AzureOpenAIModels.GPT_4_O,
				}).chat.completions.create({
					model: OpenAIModels.GPT_4_O,
					temperature: 0,
					messages: [
						{
							role: 'system',
							content: prompt,
						},
						{
							role: 'user',
							content: 'What is the summary of the conversation? Ensure to include key information obtained and what was talked about.',
						},
					],
				})

				const summary = choices[0].message.content

				const systemMessage = {
					date: new Date(),
					author: 'system' as const,
					text: `**This is a transfer from another agent, here is the previous agent call summary**\n\n${summary}`,
				}

				// Find the index of the first AI message
				const firstAIMessageIndex = newConversationHistory.findIndex(message => message.author === 'ai')

				if (firstAIMessageIndex !== -1) {
					newConversationHistory.splice(firstAIMessageIndex, 0, systemMessage)
				} else {
					newConversationHistory.push(systemMessage)
				}

				conversationHistory = newConversationHistory

				socket.emit('data', conversationHistory)

				const initialMessage = newConversationHistory.length > 0 ? newConversationHistory[2] : { author: 'ai', text: 'Welcome to your new session!' }
				socket.emit('interim_message', initialMessage.text)
			}

			lastCompletedNode = matchingNode
			if (!lastCompletedNode.data.times_visited) {
				lastCompletedNode.data.times_visited = 0
			}
			lastCompletedNode.data.times_visited++

			await saveUsageForPreview(interview)
		} catch (error) {
			_onError(error)
		}
	})

	socket.on('disconnect', () => {
		logger.debug(`Interview test socket disconnected: ${socket.handshake.query.interview_id}`)
	})

	if (typeof socket.handshake.query.interview_id !== 'string') {
		throw new Error('Interview ID not provided')
	}

	interview = await InterviewEntity.findOneOrFail({
		where: { id: socket.handshake.query.interview_id },
		relations: ['flow', 'team'],
	})

	let generateNewConversationHistory = true

	if (typeof socket.handshake.query.conversation_history === 'string') {
		const conversationHistoryQuery = JSON.parse(socket.handshake.query.conversation_history)

		if (conversationHistoryQuery.length) {
			logger.debug('Using conversation history from handshake')
			generateNewConversationHistory = false
			conversationHistory = conversationHistoryQuery
		}
	}

	if (generateNewConversationHistory) {
		conversationHistory = await generateInitialConversationHistory({
			interview: interview,
			type: InterviewResponseType.BROWSER_TEXT,
		})
		await saveUsageForPreview(interview)
	}

	socket.emit('data', conversationHistory)

	if (interview.genius_id) {
		logger.info(`Getting Pinecone index for genius ${interview.genius_id}`)
		pineconeIndex = getPineconeIndex(interview.genius_id)
	}

	logger.debug(`Interview test socket connected: ${socket.handshake.query.interview_id}`)
}
