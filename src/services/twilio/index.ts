import * as Twilio from 'twilio'

export const masterTwilioClient = () => Twilio(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN
)

export const twilioClient = (sid: string, secret: string) => Twilio(sid, secret)

export const twilioClientWithArgs = (args: {
	accountSid?: string
}) => Twilio(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN,
	args,
)

export const twilioVerifyClient = () => masterTwilioClient().verify.v2.services(process.env.TWILIO_VERIFY_SID)

export type PhoneNumber = string;

export interface TwilioMessageParams {
	to: PhoneNumber;
	from?: PhoneNumber;
	body: string;
	messagingServiceSid?: string;
}

export interface TwilioMessageResponse {
	messageId: string;
}

/**
 * Checks if a string contains a valid phone number using regex.
 * Ex: '+14162223434' is valid
 *
 * @param numberToCheck: phone number string
 */
export const isNumberValid = (numberToCheck: PhoneNumber): boolean => {
	const regexGroups =
		numberToCheck.match(/^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s./0-9]*$/g)

	return regexGroups.length > 0 && numberToCheck.replace('+', '').length >= 10
}

export interface TwilioWebhookBody {
	ToCountry: string
	ToState: string
	SmsMessageSid: string
	NumMedia: string
	ToCity: string
	FromZip: string
	SmsSid: string
	FromState: string
	SmsStatus: string
	FromCity: string
	Body: string
	FromCountry: string
	To: string
	MessagingServiceSid: string
	ToZip: string
	NumSegments: string
	MessageSid: string
	AccountSid: string
	From: string
	ApiVersion: string
}
