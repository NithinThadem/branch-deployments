import axios from 'axios'

type NvidiaCompletionArgs = {
	messages: {
		content: string
		role: 'system' | 'user' | 'assistant'
	}[]
	stream: boolean
}

type NvidiaChatCompletionChoice = {
	index: number
	delta: {
		role: 'system' | 'user' | 'assistant'
		content: string
	}
	finish_reason: string
}

type NvidiaChatCompletionResponse = {
	id: string
	choices: NvidiaChatCompletionChoice[]
}

export async function nvidiaCompletion(
	args: NvidiaCompletionArgs & { stream: true }
): Promise<AsyncGenerator<NvidiaChatCompletionChoice>>

export async function nvidiaCompletion(
	args: NvidiaCompletionArgs & { stream: false }
): Promise<string>

export async function nvidiaCompletion(
	args: NvidiaCompletionArgs
): Promise<string | AsyncGenerator<NvidiaChatCompletionChoice>> {
	try {
		const response = await axios({
			method: 'POST',
			url: 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions/8f4118ba-60a8-4e6b-8574-e38a4067a4a3',
			data: {
				messages: args.messages.map((message) => ({
					role: message.role === 'system' ? 'user' : message.role,
					content: message.content,
				})),
				temperature: 0.2,
				top_p: 0.7,
				stream: true,
			},
			headers: {
				Authorization: `Bearer ${process.env.NVIDIA_NGC_KEY}`,
				Accept: 'text/event-stream',
				'Content-Type': 'application/json',
			},
			responseType: 'stream',
		})

		if (args.stream) {
			return (async function* () {
				for await (const chunk of response.data) {
					try {
						const json = chunk.toString('utf-8').replace(/data: /g, '')
						const data = JSON.parse(json) as NvidiaChatCompletionResponse
						yield data.choices[0]
					} catch (error) {
						// noop
					}
				}
			})()
		} else {
			let buffer = ''
			for await (const chunk of response.data) {
				try {
					const json = chunk.toString('utf-8').replace(/data: /g, '')
					const data = JSON.parse(json) as NvidiaChatCompletionResponse
					buffer += data.choices[0].delta.content
					if (data.choices[0].finish_reason !== null) {
						return buffer
					}
				} catch (error) {
					// noop
				}
			}
		}
	} catch (error) {
		let streamString = ''
		if (error.response) {
			error.response.data.setEncoding('utf8')
			error.response.data
				.on('data', (utf8Chunk) => { streamString += utf8Chunk })
				.on('end', () => {
					throw new Error(streamString)
				})
		} else {
			throw error
		}
	}
}
