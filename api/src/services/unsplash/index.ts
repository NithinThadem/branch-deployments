import { createApi } from 'unsplash-js'

const unsplash = createApi({
	accessKey: process.env.UNSPLASH_ACCESS_KEY,
})

export default unsplash
