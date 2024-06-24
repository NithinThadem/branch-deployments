/* eslint-disable max-len */
import { getPrompt } from '../../../services/prompts'
import { snakeCaseToTitleCase } from '../../../util/helpers.util'
import { InterviewEntity } from '../../interview/db/interview.entity'
import {
	InterviewEdge, InterviewFunction, InterviewFunctionParameters, InterviewNode,
} from './interview-flow.types'
import { InterviewFlowEntity } from './interview-flow.entity'
import logger from '../../../util/logger.util'
import { ContactEntity } from '../../contact/db/contact.entity'
import { graphlib, layout } from '@dagrejs/dagre'
import { captureError } from '../../../util/error.util'
import { formatCalendlyPrompt, getAvailableTimes } from '../../../services/calendly'
import { ActionDetail, InterviewResponseStatus } from '../../interview-response/db/interview-response.types'
import { InterviewLanguage } from '../../../modules/interview/db/interview.types'
import { translate } from '../../../services/i18n'
import { InterviewResponseEntity } from '../../interview-response/db/interview-response.entity'
import ghl from '../../../services/ghl'
import { findActionToRun } from '../../public/api/public.helpers'
import { InterviewFunctionName } from './interview-flow.types'

export const replacePlaceholders = (
	description: string,
	contact?: ContactEntity,
	metadata?: Record<string, string>
): string => {
	if (!description) { return description }

	if (contact) {
		// Replace contact name
		if (contact.name) {
			const firstName = contact.name.split(' ')[0]
			description = description.replace(/\{id: Contact: Name, value: Contact: Name\}/g, firstName)
		} else {
			description = description.replace(/\{id: Contact: Name, value: Contact: Name\}/g, '')
		}

		// Replace contact email
		if (contact.email) {
			description = description.replace(/\{id: Contact: Email, value: Contact: Email\}/g, contact.email)
		} else {
			description = description.replace(/\{id: Contact: Email, value: Contact: Email\}/g, '')
		}

		// Replace contact phone number
		if (contact.phone_number) {
			description = description.replace(/\{id: Contact: Phone Number, value: Contact: Phone Number\}/g, contact.phone_number)
		} else {
			description = description.replace(/\{id: Contact: Phone Number, value: Contact: Phone Number\}/g, '')
		}
	}

	// Replace placeholders for attributes
	if (contact && contact.attributes) {
		Object.entries(contact.attributes).forEach(([key, value]) => {
			const attributePlaceholder = new RegExp(`\\{id: Attribute: ${key}, value: Attribute: ${key}\\}`, 'g')
			description = description.replace(attributePlaceholder, value)
		})
	}

	// Replace metadata placeholders
	if (metadata) {
		Object.entries(metadata).forEach(([key, value]) => {
			const placeholder = new RegExp(`{${key}}`, 'g')
			description = description.replace(placeholder, value)
		})
	}

	// Clean description of brackets
	description = description.replace(/{/g, '').replace(/}/g, '')
	return description
}

export const getInterviewPrompt = async ({
	interview,
	contact,
	metadata,
}: {
	interview: InterviewEntity
	contact?: ContactEntity
	metadata?: Record<string, string>
}) => {
	if (!interview.flow || !interview.flow.nodes || !interview.flow.edges) {
		throw new Error('No nodes or edges found')
	}

	const assertivenessLevel = interview.personality_customization?.assertiveness_level || 0
	const humorLevel = interview.personality_customization?.humor_level || 0

	const { assertivenessPrompt, humorPrompt } = await getPrompt.personalityPrompt({ assertiveness_level: assertivenessLevel, humor_level: humorLevel })
	const calendlyFunction = interview.flow.functions?.find(f => f.name === InterviewFunctionName.CALENDLY)
	const ghlFunction = interview.flow.functions?.find(f => f.name === InterviewFunctionName.HIGHLEVEL)

	const usesCalendly = interview.flow.nodes.some(n => String(n.data.function) === InterviewFunctionName.CALENDLY)
	const usesGHL = interview.flow.nodes.some(n => String(n.data.function) === InterviewFunctionName.HIGHLEVEL)
	if (usesCalendly && usesGHL) {
		throw new Error('Interview cannot use both Calendly and GHL')
	}

	let timezone = 'UTC'
	if (calendlyFunction && calendlyFunction.metadata.timezone) {
		timezone = calendlyFunction.metadata.timezone
	}

	const previousInterviewResponses = await InterviewResponseEntity.find({
		where: {
			interview: {
				id: interview.id,
			},
			status: InterviewResponseStatus.ENDED,
			contact: { id: contact?.id },
		},
		take: 5,
		order: {
			created: 'DESC',
		},
	})

	const previousCallSummaries = previousInterviewResponses?.filter(response => response.summary_data).map((response) => response.summary_data)

	const greetingNode = interview.flow.nodes.find(n => n.data.type === 'start')
	const greeting = greetingNode ? replacePlaceholders(greetingNode.data.description, contact, metadata) : ''

	const rules = greetingNode?.data.additional_prompting || []

	const rulesText = rules.length > 0
		? `\n\nHere are the rules set by the user for the greeting:\n\n${rules.map((rule, index) => `${index + 1}: ${rule}`).join('\n')}`
		: ''

	const combinedGreeting = `${greeting}${rulesText}`

	let prompt = await getPrompt.startCall({
		greeting: combinedGreeting,
		team_name: interview.team.name,
		language: interview.lang,
		type: snakeCaseToTitleCase(interview.type),
		contact,
		objective: `Conduct a ${snakeCaseToTitleCase(interview.type)} phone call with the caller.`,
		assertiveness_level_prompt: assertivenessPrompt,
		humor_level_prompt: humorPrompt,
		timezone,
		previousCallSummaries,
	})

	// Check if the interview uses Calendly
	if (usesCalendly && calendlyFunction) {
		const times = await getAvailableTimes({
			url: calendlyFunction.metadata.calendly_url,
			timezone: calendlyFunction.metadata.timezone,
			forwardDays: calendlyFunction.metadata.calendly_forward_days,
		})
		prompt += formatCalendlyPrompt(times, calendlyFunction.metadata.timezone)
	} else if (usesGHL && ghlFunction) {
		// Check if the interview uses HighLevel
		const times = await ghl.getAvailableTimes({
			calendarId: ghlFunction.metadata.ghl_calendar_id,
			timezone: ghlFunction.metadata.timezone,
			integrationId: ghlFunction.metadata.integration_id,
			ghlLocationId: ghlFunction.metadata.location_id,
		})
		prompt += ghl.formatTimes(times, ghlFunction.metadata.timezone)
	}

	return prompt
}

const processABNodes = (flow: InterviewFlowEntity) => {
	const nodes = JSON.parse(JSON.stringify(flow.nodes))
	const edges = JSON.parse(JSON.stringify(flow.edges))
	const abNodeIds = new Set()
	const selectedTargets = new Map()
	const nodesToRemove = new Set<string>()
	const edgesToRemove = new Set<string>()
	const processedNodes = []
	const processedEdges = []

	// Process A/B nodes
	nodes.forEach(node => {
		if (node.data.segment_type === 'a/b') {
			abNodeIds.add(node.id)
			const abEdges = edges.filter(e => e.source === node.id)
			if (abEdges.length > 0) {
				const selectedEdge = abEdges[Math.floor(Math.random() * abEdges.length)]
				selectedTargets.set(node.id, selectedEdge.target)

				abEdges.forEach(edge => {
					if (edge.target !== selectedEdge.target) {
						nodesToRemove.add(edge.target)
						edges.forEach(e => {
							if (e.source === edge.target || e.target === edge.target) {
								edgesToRemove.add(e.id)
							}
						})
					}
				})
			}
		}
	})

	// Filter nodes and edges
	nodes.forEach(node => {
		if (!nodesToRemove.has(node.id) && node.data.segment_type !== 'a/b') {
			processedNodes.push(node)
		}
	})

	edges.forEach(edge => {
		if (!edgesToRemove.has(edge.id) && !abNodeIds.has(edge.source)) {
			if (abNodeIds.has(edge.target)) {
				const newTarget = selectedTargets.get(edge.target)
				if (newTarget) {
					processedEdges.push({ ...edge, target: newTarget })
				}
			} else {
				processedEdges.push(edge)
			}
		}
	})

	return {
		nodes: processedNodes,
		edges: processedEdges,
	}
}

const getInstructionsForAction = (node: InterviewNode) => {
	if (typeof node.data?.function === 'string') {
		switch (node.data.function) {
			case 'CALENDLY': {
				return 'You have been provided with available dates and times for a meeting. Please schedule a meeting with the caller. Work with them to find a time that works for both of you.'
			}
			case 'HIGHLEVEL': {
				return 'You have been provided with available dates and times for a meeting. Give the caller the available day/time ranges, and work with them to find a specific slot that works for both of you.'
			}
			case 'API_CALL': {
				return '**An API call is being made. Please wait for the response. And go to the next step based on the response.**'
			}
		}
	}
}

export const transformScriptToMermaid = ({
	nodes,
	edges,
	contact,
	metadata,
	fn_params,
	lang = InterviewLanguage.en,
	blankValueTracker,
}: {
	nodes: InterviewNode[]
	edges: InterviewEdge[]
	contact?: ContactEntity
	metadata?: Record<string, string>
	fn_params?: Record<string, InterviewFunctionParameters>
	blankValueTracker?: { nodeId: string; value: string }[]
	lang?: InterviewLanguage
}): { mermaidGraph: string, labelToNodeIdMap: Record<string, string> } => {
	const flow = {
		nodes,
		edges,
	} as InterviewFlowEntity

	function filterValidEdges(nodes: InterviewNode[], edges: InterviewEdge[]): InterviewEdge[] {
		const validEdges: InterviewEdge[] = []
		const outcomesMap = new Map<string, Set<string>>() // Maps node ID to a set of valid outcome identifiers.
		const edgePresenceMap = new Map<string, boolean>() // Tracks if any edge from a source has a defined handle.

		// Populate the outcomesMap with valid outcome identifiers from each node
		nodes.forEach(node => {
			const validOutcomes = new Set<string>()
			node.data.outcomes?.forEach(outcome => {
				validOutcomes.add(outcome)
			})
			outcomesMap.set(node.id, validOutcomes)
		})

		// First pass to detect any source node with a defined handle
		edges.forEach(edge => {
			if (edge.sourceHandle && edge.sourceHandle !== '_') {
				edgePresenceMap.set(edge.source, true)
			}
		})

		// Filter edges based on matching outcomes to source handles
		edges.forEach(edge => {
			const validOutcomes = outcomesMap.get(edge.source)
			const normalizedSourceHandle = edge.sourceHandle?.replace(/^_/, '')

			// Check if the edge is valid
			if (validOutcomes?.has(normalizedSourceHandle)) {
				validEdges.push(edge)
			} else if (!edgePresenceMap.get(edge.source) && (edge.sourceHandle === undefined || edge.sourceHandle === '_')) {
				// Include edges with undefined or '_' source handles only if there are no other edges with defined handles from the same source
				validEdges.push(edge)
			}
		})

		return validEdges
	}

	const cleanedEdges = filterValidEdges(nodes, edges)

	processABNodes(flow)

	for (const node of nodes) {
		if (node.data.description) {
			node.data.description = replacePlaceholders(node.data.description, contact, metadata)
		}
	}
	const sanitizeDescription = (description: string) => description
		.replace(/[{}|]/g, '')
		.replace(/[\r\n\t]+/g, ' ')
		.trim()

	const replaceNodeIndexPlaceholders = (description) => {
		if (typeof description !== 'string') {
			return description
		}
		// Regex to match the pattern {id: <id>, value: Node_<index>.response.<path>}
		const regexWithResponse = /id:\s*([a-f0-9-]+),\s*value:\s*Node_\d+\.(response\.[\w.-]+)/
		// const regexWithResponse = /id:\s*([a-f0-9-]+),\s*value:\s*Node_\d+\.(response\..+)/

		// Updated to match and discard any labels like 'Answer' after the node index
		const regexWithoutResponse = /id:\s*([a-f0-9-]+),\s*value:\s*Node(?:_| #)(\d+)(?:\s*:\s*Answer)?\s*:\sAnswer/g

		return description
			.replace(regexWithResponse, (_match, id, responsePath) => `**${id}, ${responsePath}**`).replace('response.', '')
			.replace(regexWithoutResponse, (_match, id, _index) => `**${id}**`)
	}

	// Function to replace the variables in the node with actual values
	const replaceVariables = (text, blankValueTracker) => {
		let value
		let replacedText = text

		if (!Array.isArray(blankValueTracker)) {
			return text
		}
		replacedText = replacedText.replace(/\*\*([a-f0-9-]+)(?:, ([\w.]+))?\*\*/g, (match, nodeId, responsePath) => {
			const trackerEntry = blankValueTracker.find(entry => entry.nodeId === nodeId)

			if (trackerEntry) {
				if (responsePath) {
					if (typeof(trackerEntry.value) === 'string') {
						value = JSON.parse(trackerEntry.value)
					}
					value = getNestedValue(value, responsePath)

					if (value !== undefined) {
						return value
					}
				} else {
					if (trackerEntry.value !== '') {
						return trackerEntry.value
					}
				}
			}

			return match
		})

		return replacedText
	}

	const getNestedValue = (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj)

	// Initialize mermaid graph
	let mermaidGraph = 'flowchart TB\n'
	const addedNodes = new Set()
	const labelToNodeIdMap = {}
	const edgeList = []

	// Create a mapping of node ID to outgoing edges
	const graph = new Map()
	cleanedEdges.forEach(edge => {
		if (!graph.has(edge.source)) {
			graph.set(edge.source, [])
		}
		graph.get(edge.source).push(edge)
	})

	let nodeIndex = 1

	// Recursive function to add nodes
	function addNode(currentNode, nodeIndex) {
		if (!currentNode || addedNodes.has(currentNode.id)) { return }

		currentNode.data.description = replaceNodeIndexPlaceholders(currentNode.data.description)
		const label = `${nodeIndex}`
		let nodeText = currentNode.data.description ? sanitizeDescription(`SAY: "${currentNode.data.description}"`) : ''
		let rulesText = ''

		// Check if there are additional prompting rules and format them
		if (currentNode.data.additional_prompting && currentNode.data.additional_prompting.length > 0) {
			const rules = currentNode.data.additional_prompting.map(rule => `Rule: ${rule}`).join('\n')
			rulesText = `**[ADDITIONAL_RULES_${nodeIndex}:\n${rules}\n]**`
		}
		if (currentNode.data.segment_type === 'action') {
			const functionName = currentNode.data.function

			if (functionName === 'PHONE_ROUTER') {
				const transferDescription = translate('transfer', { phoneNumber: currentNode.data.phone_number_name }, { lang: lang })
				nodeText = sanitizeDescription(`SAY: "${transferDescription}"`)
			} else if (functionName === 'AGENT_TRANSFER') {
				nodeText = sanitizeDescription(`FUNCTION: AGENT_TRANSFER, SAY: "Transferring you to ${currentNode.data.agent_transfer.agent_name} now"`)
			} else if (functionName === 'API_CALL') {
				nodeText = getInstructionsForAction(currentNode) || ''
			} else {
				const instructions = getInstructionsForAction(currentNode) ||
					fn_params?.[functionName]?.description || ''
				nodeText += instructions ? `DO: ${instructions}` : ''

				if (fn_params?.[functionName]?.enum) {
					nodeText += ` Options: ${fn_params[functionName].enum.join(', ')}.`
				}
			}
		}

		nodeText = `[${nodeText}]`
		if (rulesText) {
			nodeText += `\n${rulesText}`
		}

		mermaidGraph += `    ${label}: ${nodeText}\n`
		addedNodes.add(currentNode.id)
		labelToNodeIdMap[nodeIndex] = currentNode.id
	}

	function collectEdges(sourceNode, targetNode, edge) {
		if (!sourceNode || !targetNode) {
			return
		}

		const sourceIndex = Object.keys(labelToNodeIdMap).find(key => labelToNodeIdMap[key] === sourceNode.id)
		const targetIndex = Object.keys(labelToNodeIdMap).find(key => labelToNodeIdMap[key] === targetNode.id)

		if (sourceIndex === undefined || targetIndex === undefined) {
			return
		}

		const sourceLabel = `${sourceIndex}`
		const targetLabel = `${targetIndex}`
		const outcome = edge.sourceHandle ? edge.sourceHandle.replace(/^_/, '') : 'default'
		edgeList.push({ sourceLabel, targetLabel, outcome })
	}

	// Recursive function to traverse the graph
	function traverseGraph(nodeId, graph, nodes, addedNodes) {
		if (!nodeId || addedNodes.has(nodeId)) { return }
		const currentNode = nodes.find(node => node.id === nodeId)
		if (!currentNode) { return }

		// Add current node to the graph rendering and mark it as visited
		addNode(currentNode, nodeIndex++)
		addedNodes.add(nodeId)

		const outgoingEdges = graph.get(nodeId) || []
		outgoingEdges.forEach(edge => {
			const targetNode = nodes.find(n => n.id === edge.target)
			if (targetNode && !addedNodes.has(targetNode.id)) {
				traverseGraph(targetNode.id, graph, nodes, addedNodes)
			}
			// Add edge to the graph rendering
			collectEdges(currentNode, targetNode, edge)
		})
	}

	function appendEdges() {
		edgeList.sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel))

		edgeList.forEach(edge => {
			mermaidGraph += edge.outcome
				? `    ${edge.sourceLabel} --> |"${edge.outcome}"| --> ${edge.targetLabel}\n`
				: `    ${edge.sourceLabel} --> ${edge.targetLabel}\n`
		})
	}

	const startNodeId = nodes.find(n => n.data.type === 'start')?.id
	traverseGraph(startNodeId, graph, nodes, addedNodes)
	appendEdges()

	// After building the graph and adding all nodes and edges, replace the variables in the graph with actual values
	mermaidGraph = replaceVariables(mermaidGraph, blankValueTracker)
	return { mermaidGraph: mermaidGraph.trim(), labelToNodeIdMap }
}

export const transformScript = ({
	flow: {
		nodes,
		edges,
	},
	genius_id,
}: InterviewEntity): string => {
	let script = ''
	const edgesMap = new Map<string, InterviewEdge[]>()
	const nodeToStepMap = new Map<string, number>()

	nodes.sort((a, b) => {
		if (a.data.type === 'start') { return -1 }
		if (b.data.type === 'start') { return 1 }
		if (a.data.type === 'end') { return 1 }
		if (b.data.type === 'end') { return -1 }
		return 0
	})

	// Map each node to its outgoing edges for quick access
	edges.forEach(edge => {
		if (edge.sourceHandle) { // Only consider edges with a source handle
			const sourceEdges = edgesMap.get(edge.source) || []
			sourceEdges.push(edge)
			edgesMap.set(edge.source, sourceEdges)
		}
	})

	// Assign step numbers to nodes based on breadth-first traversal
	const startNode = nodes.find(n => n.data.type === 'start')
	if (startNode) {
		const queue = [startNode]
		const visited = new Set<string>()
		let stepCounter = 1

		while (queue.length > 0) {
			const node = queue.shift()
			if (!visited.has(node.id)) {
				visited.add(node.id)
				nodeToStepMap.set(node.id, stepCounter++)

				const outgoingEdges = edgesMap.get(node.id)
				if (outgoingEdges) {
					outgoingEdges.forEach(edge => {
						const targetNode = nodes.find(n => n.id === edge.target)
						if (targetNode && !visited.has(targetNode.id)) {
							queue.push(targetNode)
						}
					})
				}
			}
		}
	}

	// Function to build the script text

	const buildScriptText = (nodeId: string, currentStep: number) => {
		const node = nodes.find(n => n.id === nodeId)
		if (!node) { return '' }

		if (node.data.segment_type === 'genius' && !genius_id) {
			logger.warn(`Genius node ${nodeId} found, but no genius_id provided`)
			return ''
		}

		let nodeScript = `STEP ${currentStep}: ${node.data.title}\n`
		if (node.data.description) {
			nodeScript += `  ${node.data.description.replace(/\n/g, ' ')}\n`
		}

		// Include 'genius' questions and answers if they are present
		// if (node.data.genius && node.data.genius.length > 0) {
		// 	node.data.genius.forEach((geniusItem, index) => {
		// 		nodeScript += `  Q${index + 1}: ${geniusItem.question}\n`
		// 		nodeScript += `  A${index + 1}: ${geniusItem.answer}\n`
		// 	})
		// 	nodeScript += '  Remain on this step to answer any of the above questions if asked by the caller.\n'
		// }

		if (node.data.segment_type === 'genius') {
			nodeScript += '  Remain on this step to answer any of the questions asked by the caller using the information provided until the user proceeds to the next step.\n'
		}

		if (node.data.function) {
			nodeScript += `  Call function: ${node.data.function}\n`
		}

		const outgoingEdges = edgesMap.get(nodeId)
		if (outgoingEdges) {
			if (outgoingEdges.length > 1) {
				// Multiple outcomes: use indented IF-THEN statements
				nodeScript += outgoingEdges.map(edge => {
					const targetStep = nodeToStepMap.get(edge.target)
					const outcome = edge.sourceHandle.replace(/^_/, '') // Remove leading '_'
					return `  IF "${outcome}" THEN go to STEP ${targetStep}`
				}).join('\n') + '\n'
				// nodeScript += '  IF none of the above, THEN politely re-ask the question and provide the caller with the available options.\n'
			} else if (outgoingEdges.length === 1 && node.data.segment_type !== 'genius') {
				// Single outcome: proceed without condition, but only if there are no genius questions
				const targetStep = nodeToStepMap.get(outgoingEdges[0].target)
				nodeScript += `  THEN: go to STEP ${targetStep}\n`
			}
		}

		if (node.data.type === 'end') {
			nodeScript += '  THEN end the call using the "end_call" action.\n'
		}

		return nodeScript + '\n' // Add extra newline for separation between steps
	}

	if (startNode) {
		nodes.forEach(node => {
			const step = nodeToStepMap.get(node.id)
			if (step !== undefined) {
				script += buildScriptText(node.id, step)
			}
		})
	}
	return script.trim()
}

export const transformFunctionsToParams = (functions: InterviewFunction[]): Record<string, InterviewFunctionParameters> => {
	const response: Record<string, InterviewFunctionParameters> = {}

	functions.forEach((fn) => {
		if (fn.name === 'PHONE_ROUTER') {
			response[fn.name] = {
				description: fn.description,
				...fn.parameters,
			}
		}
	})

	return response
}

function transformUrl(url, valueTracker) {
	// Ensure the URL starts with https://
	if (!/^https?:\/\//i.test(url)) {
		url = 'https://' + url
	}

	if (!valueTracker) {
		return url
	}

	const pattern = /\{id:\s*([^,]+),\s*value:\s*[^}]+\}/
	return url.replace(pattern, (match, id) => {
		const actualValue = valueTracker.find(tracker => tracker.nodeId === id)?.value
		return actualValue || match
	})
}

/**
 * Helper function to make an API call
 *
 * @param matchingNode The node that contains the API call
 * @param query Query parameters to be added to the URL
 * @param headers Headers to be added to the request
 * @param body Body to be added to the request
 *
 */
export const makeApiCall = async (
	matchingNode: InterviewNode,
	valueTracker?: { nodeId: string; value: string }[],
	query: object = {},
	headers: object = {},
	body: object = {},
	rawEndpoint: string = '',
) => {
	if (!rawEndpoint) { logger.warn('API call endpoint not found or is invalid') }

	const endpoint = transformUrl(rawEndpoint, valueTracker)
	const url = new URL(endpoint)

	const method = matchingNode.data.api_request?.method || 'GET'

	const fetchOptions: RequestInit = {
		method,
		headers: headers as HeadersInit,
	}

	fetchOptions.headers = fetchOptions.headers || {}
	fetchOptions.headers['Content-Type'] = 'application/json'

	Object.keys(query).forEach(key => {
		url.searchParams.append(key, query[key])
	})

	if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
		if (Object.keys(body).length) {
			fetchOptions.body = JSON.stringify(body)
		}
	}

	try {
		logger.debug(`Performing API call to ${url.toString()}`)
		const response = await fetch(url.toString(), fetchOptions)

		if (response.ok) {
			const contentType = response.headers.get('content-type')
			let data

			if (contentType && contentType.includes('application/json')) {
				data = await response.json().catch(() => null)
			} else {
				data = await response.text().catch(() => null)
			}

			return { data }
		} else {
			const text = await response.text().catch(() => 'Failed to retrieve text content')
			logger.error(`API call failed with status: ${response.status}`)
			return { error: text }
		}
	} catch (error) {
		logger.error(`API call failed: ${error.message}`)
		return { error: error.message }
	}
}

export const handleCompletionDataResponse = async ({
	matchingNode,
}: {
	matchingNode?: InterviewNode;
}): Promise<{ _shouldEndCall: boolean; _shouldTransferCallTo?: string; _actionDetail?: ActionDetail, actionOutput?: object, _shouldTransferAgentTo?: string }> => {
	let _shouldEndCall: boolean = false
	let _shouldTransferCallTo: string = ''
	let _shouldTransferAgentTo: string = ''
	let _actionDetail: ActionDetail | undefined
	const actionOutput: object = null

	try {
		if (matchingNode?.data?.type === 'end') {
			_shouldEndCall = true
		}

		if (matchingNode?.data?.phone_number && (matchingNode.data.function as any) === 'PHONE_ROUTER') {
			_shouldTransferCallTo = matchingNode.data.phone_number
			_actionDetail = {
				action_type: 'PHONE_ROUTER',
				phone_number: matchingNode.data.phone_number,
			}
		}

		if (String(matchingNode?.data?.function) === 'AGENT_TRANSFER') {
			_shouldTransferAgentTo = matchingNode.data.agent_transfer.interview_id
		}
	} catch (error) {
		captureError(error)
	}

	return { _shouldEndCall, _shouldTransferCallTo, _actionDetail, actionOutput, _shouldTransferAgentTo }
}

export const layoutNodesAndEdges = (nodes: InterviewNode[], edges: InterviewEdge[]): { nodes: InterviewNode[], edges: InterviewEdge[] } => {
	// Create a new directed graph
	const g = new graphlib.Graph()

	// Set an object for the graph label
	g.setGraph({
		rankdir: 'TB', // Layout direction: Top to bottom
		align: 'UL', // Alignment of nodes: Upper Left
		ranker: 'network-simplex', // Type of algorithm to assigns a rank to each node
		marginx: 500,
		marginy: 500,
	})

	// Default node and edge labels
	g.setDefaultEdgeLabel(() => ({}))

	// Adding nodes to the graph
	nodes.forEach(node => {
		g.setNode(node.id, { width: 250, height: 100 }) // Set the width and height for each node
	})

	// Adding edges to the graph
	edges.forEach(edge => {
		g.setEdge(edge.source, edge.target)
	})

	// Calculate the layout (synchronous)
	layout(g)

	// Updating node positions based on the layout
	const updatedNodes = nodes.map(node => {
		const nodeWithPosition = g.node(node.id)
		return {
			...node,
			position: { x: nodeWithPosition.x, y: nodeWithPosition.y },
		}
	})

	// Return both nodes and edges
	return { nodes: updatedNodes, edges }
}

async function processApiNode(node, contact, blankValueTracker) {
	try {
		// Replace the variables in the node with actual values
		replaceNodeValues(node, blankValueTracker, contact)
		const sanitizedHeaders = node.data.api_request?.headers.reduce((acc, { key, value }) => {
			acc[key] = value.value
			return acc
		}, {})

		const sanitizedQuery = node.data.api_request?.query.reduce((acc, { key, value }) => {
			acc[key] = value.value
			return acc
		}, {})

		const sanitizedBody = node.data.api_request?.body.reduce((acc, { key, value }) => {
			acc[key] = value.value
			return acc
		}, {})

		// make the api call
		const apiResponse = await makeApiCall(
			node,
			blankValueTracker,
			sanitizedQuery,
			sanitizedHeaders,
			sanitizedBody,
			node.data.api_request.url
		)

		if (!apiResponse) {
			logger.error(`Failed to process API call for node ${node.id}`)
			return { actionType: 'API_CALL', response: { data: null, error: 'Failed API call' }, nodeId: node.id }
		}

		// Update the blank value tracker with the response
		return { actionType: 'API_CALL', response: apiResponse, nodeId: node.id }
	} catch (error) {
		logger.error(`Failed to process API call for node ${node.id}: ${error}`)
		return { actionType: 'API_CALL', response: { data: null, error: 'Failed API call' }, nodeId: node.id }
	}
}

export const handleSecondaryActions = async ({
	nodes,
	edges,
	contact,
	blankValueTracker,
	lastCompletedNode,
	userAnswer,
	secondaryActionOutputs,
	interviewId,
	responseId,
}: {
	nodes: InterviewNode[],
	edges: InterviewEdge[],
	contact?: ContactEntity,
	blankValueTracker?: { nodeId: string; value: string }[];
	lastCompletedNode?: InterviewNode;
	secondaryActionOutputs?: Record<string, any>;
	userAnswer?: string;
	interviewId: string;
	responseId: string;
}): Promise<Array<{ actionType: string, response?: any, nodeId?: string }>> => {
	const results = []

	// Find the downstream nodes from the last completed node
	const downstreamNodes = findFirstLayerDownstreamNodes(edges, nodes, lastCompletedNode.id)

	// Find the API nodes in the downstream nodes
	const apiNodes = downstreamNodes.filter(node => String(node.data.function) === 'API_CALL')

	let chosenNode = apiNodes.length === 1 ? apiNodes[0] : null

	// If there are multiple API nodes, choose one based on the user's answer
	if (apiNodes.length > 1) {
		const chosenNodeId = await findActionToRun({
			nodes: apiNodes,
			lastCompletedNode: lastCompletedNode,
			userAnswer: userAnswer,
			interviewId,
			responseId,
		})
		chosenNode = downstreamNodes.find(node => node.id === chosenNodeId)
	}

	if (chosenNode) {
		// Process the chosen API node
		const apiResult = await processApiNode(chosenNode, contact, blankValueTracker)
		if (apiResult) {
			results.push(apiResult)
			if (secondaryActionOutputs) {
				blankValueTracker.push({ nodeId: chosenNode.id, value: JSON.stringify(apiResult.response) })
				secondaryActionOutputs.push(apiResult)
			}
		}
	}

	for (const node of downstreamNodes) {
		if (!node.data.function) {
			logger.warn(`No secondary action found for node ${node.id}`)
			results.push({ actionType: 'None', nodeId: node.id })
			continue
		}

		let result

		const functionName = String(node.data.function)
		if (functionName === 'API_CALL') {
			continue
		} else {
			switch (functionName) {
				case 'CALENDLY':
					// todo
					result = { actionType: 'CALENDLY', nodeId: node.id }
					results.push(result)
					break

				case 'CALCULATE':
					// todo
					result = { actionType: 'CALCULATE', nodeId: node.id }
					results.push(result)
					break

				default:
					logger.warn(`Function ${functionName} not supported as a secondary action`)
					results.push({ actionType: functionName, nodeId: node.id })
					break
			}
			// if (secondaryActionOutputs) {
			// 	secondaryActionOutputs.push(result) // Append result to the outputs
			// }
		}
	}

	return results
}

export const findFirstLayerDownstreamNodes = (
	edges: InterviewEdge[],
	nodes: InterviewNode[],
	nodeId: string
) => {
	const resultNodes = []
	const resultEdges: InterviewEdge[] = []

	const outgoingEdges = edges.filter(edge => edge.source === nodeId)

	outgoingEdges.forEach((edge) => {
		const targetNodeIndex = nodes.findIndex(node => node.id === edge.target)
		if (targetNodeIndex !== -1) {
			resultNodes.push(nodes[targetNodeIndex])
		}
		resultEdges.push(edge)
	})

	return resultNodes
}

const replaceValues = (item, blankValueTracker, contact) => {
	let actualValue = item.value && typeof item.value === 'object' && 'value' in item.value ? item.value.value : item.value

	if (!actualValue) {
		return
	}

	if (typeof actualValue !== 'string') {
		return
	}

	const contactPrefix = 'Contact: '
	if (actualValue.startsWith(contactPrefix)) {
		if (!contact) {
			actualValue = ''
			return
		}

		const contactField = actualValue.substring(contactPrefix.length).toLowerCase()

		switch (contactField) {
			case 'email':
				actualValue = contact.email ? contact.email : ''
				break
			case 'phone number':
				actualValue = contact.phone_number ? contact.phone_number : ''
				break
			case 'name':
				actualValue = contact.name ? contact.name : ''
				break
			default:
				actualValue = (contact.attributes && contact.attributes[contactField]) ? contact.attributes[contactField] : ''
				break
		}
	} else if (item.value.id && blankValueTracker) {
		const valueFromTracker = blankValueTracker.find(tracker => tracker.nodeId === item.value.id)

		if (valueFromTracker) {
			switch (item.type ?? 'string') {
				case 'number':
					actualValue = parseInt(valueFromTracker.value)
					break
				case 'boolean':
					actualValue = valueFromTracker.value === 'true'
					break
				case 'object':
					try {
						actualValue = JSON.parse(valueFromTracker.value)
					} catch (error) {
						console.error('Error parsing JSON value:', error)
						actualValue = valueFromTracker.value
					}
					break
				default:
					actualValue = valueFromTracker.value
			}
			logger.debug(`Replaced ${item.key} value with tracker value: ${actualValue}`)
		} else {
			logger.debug(`No tracker value found for ${item.key} with id ${item.value.id}`)
		}
	}

	if (item.value && typeof item.value === 'object' && 'value' in item.value) {
		item.value.value = actualValue
	} else {
		item.value = actualValue
	}
}
const replaceNodeValues = (node, blankValueTracker, contact) => {
	if (!node.data || !blankValueTracker) { return }

	const headers = node.data.api_request?.headers || []
	const query = node.data.api_request?.query || []
	const body = node.data.api_request?.body || []

	headers.forEach(header => replaceValues(header, blankValueTracker, contact))
	query.forEach(q => replaceValues(q, blankValueTracker, contact))
	body.forEach(b => replaceValues(b, blankValueTracker, contact))
}
