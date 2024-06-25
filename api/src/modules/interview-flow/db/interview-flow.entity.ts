import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	BaseEntity,
	CreateDateColumn,
	UpdateDateColumn,
	VersionColumn,
	OneToOne,
	JoinColumn,
	Index,
} from 'typeorm'
import { InterviewEntity } from '../../interview/db/interview.entity'
import { InterviewEdge, InterviewFunction, InterviewNode } from './interview-flow.types'
import { blankInterviewFlow } from './interview-flow.templates'
import { InterviewType } from '../../interview/db/interview.types'
import * as _ from 'lodash'

@Entity({ name: 'interview_flow' })
export class InterviewFlowEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@CreateDateColumn({ name: 'created', type: 'timestamp with time zone' })
	created: Date

	@UpdateDateColumn({ name: 'updated', type: 'timestamp with time zone' })
	updated: Date

	@VersionColumn({ name: 'version', default: 0 })
	version: number

	// Relations

	@Index()
	@Column({ name: 'interview_id', unique: true })
	interview_id: string

	@OneToOne(() => InterviewEntity, (interview) => interview.flow, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'interview_id' })
	interview: InterviewEntity[]

	// Columns

	@Column({ type: 'jsonb', array: false, default: () => "'[]'" })
	nodes: InterviewNode[]

	@Column({ type: 'jsonb', array: false, default: () => "'[]'" })
	edges: InterviewEdge[]

	@Column({ type: 'jsonb', array: false, default: () => "'[]'" })
	functions: InterviewFunction[]

	static createFlowFromType(interview_id: string, type: InterviewType) {
		return this.create({
			interview_id,
			...blankInterviewFlow,
		})
	}

	static async createNode(interview_id: string, newNode: InterviewNode) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.nodes.push(newNode)
		await interviewFlow.save()
	}

	static async updateNode(interview_id: string, updatedNode: InterviewNode) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})

		interviewFlow.nodes = interviewFlow.nodes.map(node =>
			node.id === updatedNode.id ? { ...node, ...updatedNode } : node
		)
		await interviewFlow.save()
	}

	static async deleteNode(interview_id: string, nodeId: string) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.nodes = interviewFlow.nodes.filter(node => node.id !== nodeId)
		await interviewFlow.save()
	}

	static async createEdge(interview_id: string, newEdge: InterviewEdge) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.edges.push(newEdge)
		await interviewFlow.save()
	}

	static async updateEdge(interview_id: string, updatedEdge: InterviewEdge) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.edges = interviewFlow.edges.map(edge =>
			edge.id === updatedEdge.id ? { ...edge, ...updatedEdge } : edge
		)
		await interviewFlow.save()
	}

	static async deleteEdge(interview_id: string, edgeId: string) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.edges = interviewFlow.edges.filter(edge => edge.id !== edgeId)
		await interviewFlow.save()
	}

	static async updateFunctions(interview_id: string, updatedFunctions: InterviewFunction[]) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})
		interviewFlow.functions = updatedFunctions
		await interviewFlow.save()
	}

	static async batchUpdate(interview_id: string, data: {
		createNodes: InterviewNode[],
		updateNodes: InterviewNode[],
		deleteNodeIds: string[],
		createEdges: InterviewEdge[],
		updateEdges: InterviewEdge[],
		deleteEdgeIds: string[]
	}) {
		const interviewFlow = await this.findOneOrFail({
			where: { interview_id },
		})

		data.createNodes = _.uniqBy(data.createNodes, 'id')
		data.updateNodes = _.uniqBy(data.updateNodes, 'id')
		data.createEdges = _.uniqBy(data.createEdges, 'id')
		data.updateEdges = _.uniqBy(data.updateEdges, 'id')

		// Node operations

		data.createNodes.forEach(node => interviewFlow.nodes.push(node))
		data.updateNodes.forEach(updatedNode => {
			const nodeIndex = interviewFlow.nodes.findIndex(node => node.id === updatedNode.id)
			if (nodeIndex !== -1) {
				interviewFlow.nodes[nodeIndex] = { ...interviewFlow.nodes[nodeIndex], ...updatedNode }
			}
		})
		interviewFlow.nodes = interviewFlow.nodes.filter(node => !data.deleteNodeIds.includes(node.id))

		// Edge operations

		data.createEdges.forEach(edge => interviewFlow.edges.push(edge))
		data.updateEdges.forEach(updatedEdge => {
			const edgeIndex = interviewFlow.edges.findIndex(edge => edge.id === updatedEdge.id)
			if (edgeIndex !== -1) {
				interviewFlow.edges[edgeIndex] = { ...interviewFlow.edges[edgeIndex], ...updatedEdge }
			}
		})
		interviewFlow.edges = interviewFlow.edges.filter(edge => !data.deleteEdgeIds.includes(edge.id))

		// Ensure uniqueness

		interviewFlow.nodes = _.uniqBy(interviewFlow.nodes, 'id')
		interviewFlow.edges = _.uniqBy(interviewFlow.edges, 'id')

		await interviewFlow.save()

		return interviewFlow
	}

}
