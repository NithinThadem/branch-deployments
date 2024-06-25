
const numberWords = '(zero|one|two|three|four|five|six|seven|eight|nine)'

const vmPhrases = [
	'\\bPlease leave a message after the beep\\b',
	`\\bPress ${numberWords} to leave a message\\b`,
	`\\bPress ${numberWords} for customer support\\b`,
	`\\bPress ${numberWords} to speak with a representative\\b`,
	'\\bYour call is important to us Please hold\\b',
	'\\bSorry all of our agents are busy right now\\b',
	`\\bPress ${numberWords} to return to the main menu\\b`,
	'\\bThank you for calling Please leave your name and number and we will get back to you as soon as possible\\b',
	`\\bTo hear more options, please press ${numberWords}\\b`,
	'\\bPlease leave your message and contact details after the tone\\b',
	'\\bFor more information visit our website\\b',
	`\\bTo repeat this message press ${numberWords}\\b`,
	'\\bIf you know your partys extension, you may dial it at any time\\b',
	'\\bTo save this message press the star key\\b',
	'\\bTo delete this message press the pound key\\b',
]

export const matchesVoicemailPhrase = (input: string) => {
	const regexPhrases = vmPhrases.map(phrase =>
		new RegExp(phrase, 'i')
	)

	return regexPhrases.some(regex => regex.test(input))
}
