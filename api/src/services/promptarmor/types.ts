export type PromptArmorInputAnalysisArgs = {
	input: string
	sessionId?: string
	source: string
}

export interface PromptArmorAnalysisResponse {
	detection: boolean
	isAdversarial: boolean
	info: Info
}

export interface Info {
	Code: Code
	HTML: Html
	HiddenText: HiddenText
	InvisibleUnicode: InvisibleUnicode
	Jailbreak: Jailbreak
	MarkdownImage: MarkdownImage
	MarkdownURL: MarkdownUrl
	Secrets: Secrets
	ThreatIntel: ThreatIntel
	Anomaly: Anomaly
}

export interface Code {
	detection: boolean
	metadata: Record<string, string>
}

export interface Html {
	detection: boolean
	metadata: Record<string, string>
}

export interface HiddenText {
	detection: boolean
	metadata: Record<string, string>
}

export interface InvisibleUnicode {
	detection: boolean
	metadata: any
}

export interface Jailbreak {
	detection: boolean
}

export interface MarkdownImage {
	detection: boolean
	metadata: any
}

export interface MarkdownUrl {
	detection: boolean
	metadata: any
}

export interface Secrets {
	detection: boolean
	metadata: Record<string, string>
}

export interface ThreatIntel {
	detection: boolean
}

export interface Anomaly {
	detection: boolean
	metadata: Record<string, string>
}
