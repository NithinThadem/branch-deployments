import { Application } from 'express'
import SchemaRegistry, { RouteDetails } from './schema-registry'
import { OpenAPIV3 } from 'openapi-types'
import { generatePathsSchema } from './openapi.helpers'
import * as swaggerUi from 'swagger-ui-express'

let schemaRegistry: SchemaRegistry

export function registerOpenApiSchema(routeDetails: RouteDetails) {
	if (!schemaRegistry) {
		schemaRegistry = new SchemaRegistry()
	}

	schemaRegistry.addSchema(routeDetails)
}

const getOpenApiSchema = (schemaRegistry: SchemaRegistry): OpenAPIV3.Document => ({
	openapi: '3.0.0',
	info: {
		title: 'Thoughtly API',
		version: '1.0.0',
		contact: {
			name: 'Thoughtly Support',
			email: 'support@thought.ly',
			url: 'https://thought.ly',
		},
	},
	servers: [
		{
			url: 'https://api.thought.ly',
			description: 'Production server',
		},
	],
	paths: generatePathsSchema(schemaRegistry),
	components: {
		securitySchemes: {
			ApiKeyAuth: {
				type: 'apiKey',
				in: 'header',
				name: 'x-api-token',
			},
		},
	},
	security: [
		{
			ApiKeyAuth: [],
		},
	],
})

const getSchemaRoute = (_, res) => {
	const schema = getOpenApiSchema(schemaRegistry)
	res.json(schema)
}

export const openapiRouter = (app: Application) => {
	app.use('/schema.json', getSchemaRoute)
	app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, {
		swaggerOptions: {
			url: '/schema.json',
		},
		customCss: '.swagger-ui .topbar { display: none }',
		customSiteTitle: 'Thoughtly API',
	}))
	app.get('/', (req, res) => res.redirect('/docs'))
}

export const checkPathIsApiEligible = (path: string): boolean => {
	const schemas = schemaRegistry.getAllSchemas()

	for (const schema of schemas) {
		const regexPath = schema.path.replace(/\{[^}]+\}/g, '[^/]+')

		const regex = new RegExp(`^${regexPath}$`)

		if (regex.test(path)) {
			return true
		}
	}

	return false
}
