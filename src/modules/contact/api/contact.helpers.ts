export function extractNumber(phoneNumber: string) {
	if (!phoneNumber) {
		return 0
	}

	const numericPart = phoneNumber.replace(/\D/g, '')
	return numericPart.length > 0 ? parseInt(numericPart, 10) : 0
}
