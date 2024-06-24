import axios from 'axios'
import { PromptArmorAnalysisResponse, PromptArmorInputAnalysisArgs } from './types'
import { v4 } from 'uuid'

const inputAnalysis = async (args: PromptArmorInputAnalysisArgs): Promise<PromptArmorAnalysisResponse> => {
	return {} as any
	const { data } = await axios({
		method: 'POST',
		url: 'https://api.aidr.promptarmor.com/v1/analyze/input',
		headers: {
			'Content-Type': 'application/json',
			'PromptArmor-Auth': `Bearer ${process.env.PROMPTARMOR_API_KEY}`,
			'PromptArmor-Session-Id': args.sessionId || v4(),
		},
		data: {
			content: args.input,
			source: args.source,
		},
	})

	return data
}

const promptArmor = {
	inputAnalysis,
}

export default promptArmor
