/* eslint-disable max-len */
import { Socket } from 'socket.io'
import { ConversationHistory } from '../../interview-response/db/interview-response.types'
import logger from '../../../util/logger.util'
import { UserEntity } from '../../user/db/user.entity'
import { withExponentialBackoff } from '../../../util/helpers.util'
import { createTeam } from '../../team/api/team.helpers'
import { getTeamsOfUser } from '../../../modules/user/db/user.helpers'
import { MistralModels, mistral } from '../../../services/mistral'

const onUserName = async ({
	messages,
	user,
	firstName,
	lastName,
}: {
	messages: Pick<ConversationHistory, 'text' | 'author'>[]
	user: UserEntity
	firstName: string
	lastName: string
}) => {
	user.first_name = firstName
	user.last_name = lastName

	logger.debug(`Fetching fun fact for ${firstName} ${lastName}`)

	const [{ choices: [{ message }] }] = await Promise.all([
		withExponentialBackoff(() => mistral({
			'Helicone-Property-Feature': 'Onboarding',
		}).chat.completions.create({
			model: MistralModels.LARGE,
			temperature: 0.6,
			messages: [
				{
					role: 'system' as any,
					content: `Respond with a short, 1-2 sentence fun fact specifically about the user's name, nothing more. Use emojis if you'd like! Here is the conversation so far: ${[
						...messages,
						{
							text: `Nice to meet you, ${firstName} ${lastName}!`,
						},
					].map((message) => message.text).join(' ')}`,
				},
			],
		})),
		user.save(),
	])

	return message.content
}

const onTeamName = async ({
	messages,
	user,
	teamName,
}: {
	messages: Pick<ConversationHistory, 'text' | 'author'>[]
	user: UserEntity
	teamName: string
}) => {
	logger.debug(`Fetching fun fact for ${teamName}`)

	const teams = await getTeamsOfUser(user.id)

	if (teams.length === 0) {
		logger.info(`Creating new team for ${user.first_name} ${user.last_name}`)
		await createTeam({
			team: {
				name: teamName,
			},
			user,
		})
	}

	const [{ choices: [{ message }] }] = await Promise.all([
		withExponentialBackoff(() => mistral({
			'Helicone-Property-Feature': 'Onboarding',
		}).chat.completions.create({
			model: MistralModels.LARGE,
			temperature: 0.6,
			messages: [
				{
					role: 'system' as any,
					content: `Respond with a short, 1-2 sentence witty joke about where the name of the user's company, nothing more. If you know the company, mention something specific about it. Use emojis if you'd like! Here is the conversation so far: ${messages.map((message) => message.text).join(' ')}`,
				},
			],
		})),
		user.save(),
	])

	return message.content
}

export const onOnboardingSocket = async (socket: Socket) => {
	let _user: UserEntity | null = null

	const _data = {
		firstName: '',
		lastName: '',
		teamName: '',
	}

	let _messages: Pick<ConversationHistory, 'text' | 'author'>[] = []
	let _status: 'incomplete' | 'complete' = 'incomplete'

	socket.on('data', async (data) => {
		logger.debug(`Received data: ${JSON.stringify(data)}`)

		if (data.userId && !_user) {
			_user = await UserEntity.findOne({
				where: {
					id: data.userId,
				},
			})
		}

		const teams = await getTeamsOfUser(_user?.id)

		if (_status === 'complete') {
			return socket.emit('data', {
				messages: _messages,
				status: _status,
			})
		}

		if (data.messages) {
			_messages = data.messages
		}

		if (!_user) {
			return socket.emit('data', {
				messages: _messages,
				status: _status,
			})
		}

		if (_messages.length === 0) {
			if (
				_user.first_name && _user.first_name !== '' &&
				_user.last_name && _user.last_name !== '' &&
				teams.length > 0 && teams[0].name && teams[0].name !== ''
			) {
				_messages.push(
					{
						author: 'system',
						text: 'The following is a conversation taking place between a human and an AI representing Thoughtly. The human is onboarding onto a SaaS platform called Thoughtly.',
					},
					{
						author: 'ai',
						text: 'Hi again! 👋',
					},
					{
						author: 'ai',
						text: `You're all set to work with your team at ${teams[0].name}. We'll chat again soon!`,
					},
				)
			} else {
				_messages.push(
					{
						author: 'system',
						text: 'The following is a conversation taking place between a human and an AI representing Thoughtly. The human is onboarding onto a SaaS platform called Thoughtly.',
					},
					{
						author: 'ai',
						text: 'Welcome to Thoughtly! 👋',
					},
					{
						author: 'ai',
						text: 'Thoughtly lets you build human-like agents to handle all of your phone calls, without code!',
					},
					{
						author: 'ai',
						text: 'Now, let\'s get started. What is your first name?',
					},
				)
			}
		}

		if (data.data.firstName) {
			_data.firstName = data.data.firstName.trim()
		}

		if (data.data.lastName) {
			_data.lastName = data.data.lastName.trim()
		}

		if (data.teamName) {
			_data.teamName = data.teamName.trim()
		}

		if (_messages.length === 5) {
			_messages.push({
				author: 'ai',
				text: 'Thanks! What is your last name?',
			})
		}

		if (_messages.length === 7) {
			const newMessages: Pick<ConversationHistory, 'text' | 'author'>[] = [
				{
					author: 'ai',
					text: `Nice to meet you, ${_data.firstName} ${_data.lastName}!`,
				},
				{
					author: 'ai',
					text: await onUserName({
						messages: _messages,
						user: _user,
						firstName: _data.firstName,
						lastName: _data.lastName,
					}),
				},
			]
			if (teams[0]?.name?.length > 0) {
				newMessages.push(
					{
						author: 'ai',
						text: `Anyway, you're all set to work with your team at ${teams[0].name}.`,
					},
					{
						author: 'ai',
						text: 'If you have any questions, please reach out to us. We\'re a small team that is eager to help and hear your feedback!',
					}
				)
				_status = 'complete'
			} else {
				newMessages.push({
					author: 'ai',
					text: 'Anyway, where do you work? What is the name of your company?',
				})
			}

			_messages.push(...newMessages)
		}

		if (_messages.length === 11 && _status !== 'complete') {
			_messages.push(
				{
					author: 'ai',
					text: await onTeamName({
						messages: _messages,
						user: _user,
						teamName: data.data.teamName?.trim(),
					}),
				},
				{
					author: 'ai',
					text: 'Jokes aside, that\'s all I need to know for now. Thanks for chatting!',
				},
				{
					author: 'ai',
					text: 'If you have any questions, please reach out to us. We\'re a small team that is eager to help and hear your feedback!',
				}
			)
			_status = 'complete'
		}

		socket.emit('data', {
			messages: _messages,
			status: _status,
		})
	})
}
