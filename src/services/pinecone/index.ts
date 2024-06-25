import { Pinecone as InitPinecone } from '@pinecone-database/pinecone'

const config = {
	apiKey: process.env.PINECONE_API_KEY,
	environment: process.env.PINECONE_ENVIRONMENT,
}

export const Pinecone = () => new InitPinecone(config)
