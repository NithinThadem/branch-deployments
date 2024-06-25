import { Nango } from '@nangohq/node'

const nango = new Nango({
	secretKey: process.env.NANGO_SECRET_KEY,
})

export default nango
