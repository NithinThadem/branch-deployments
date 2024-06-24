import * as PlayHT from 'playht'

export const playht = () => {
	PlayHT.init({
		apiKey: process.env.PLAYHT_SECRET_KEY,
		userId: process.env.PLAYHT_USER_ID,
	})
	return PlayHT
}
