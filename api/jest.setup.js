const path = require('path')
const dotenv = require('dotenv')
const nock = require('nock')

module.exports = async () => {
	dotenv.config({ path: path.resolve(__dirname, '.env.test') })

	nock.disableNetConnect()
	nock.enableNetConnect(/localhost/)
}
