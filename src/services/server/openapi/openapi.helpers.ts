import { RequestPart } from '../../../types'
import SchemaRegistry, { RouteDetails } from './schema-registry'
import { OpenAPIV3 } from 'openapi-types'
import { BaseEntity, EntityMetadata } from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import { convert } from 'joi-openapi'

const typeOrmTypeToOpenApiType = (column: ColumnMetadata): OpenAPIV3.SchemaObject => {
	if (column.relationMetadata) {
		return convertResponseBodyToOpenApi(column.relationMetadata.inverseEntityMetadata.target, false)
	}

	if (column.enum) {
		return {
			type: 'string',
			enum: column.enum.map(String),
		}
	}

	if (column.type === 'json' || column.type === 'jsonb') {
		return {
			type: 'object',
			additionalProperties: true,
		}
	}

	const typeMapping: { [key: string]: OpenAPIV3.NonArraySchemaObjectType } = {
		uuid: 'string',
		'timestamp with time zone': 'string',
		int4: 'integer',
		bigint: 'integer',
		jsonb: 'object',
		varchar: 'string',
	}

	return { type: typeMapping[column.type as string] || 'string' }
}

const convertResponseBodyToOpenApi = (body: any, isResponseArray: boolean): OpenAPIV3.SchemaObject => {
	if (isResponseArray) {
		return {
			type: 'array',
			items: convertResponseBodyToOpenApi(body, false),
		}
	} else if (typeof body === 'function' && body.prototype instanceof BaseEntity) {
		const metadata = body.getRepository().metadata as EntityMetadata
		const properties: { [key: string]: OpenAPIV3.SchemaObject } = {}

		metadata.columns.forEach(column => {
			properties[column.propertyName] = typeOrmTypeToOpenApiType(column)
		})

		return {
			type: 'object',
			properties,
		}
	} else if (typeof body === 'object' && body !== null) {
		const properties: { [key: string]: OpenAPIV3.SchemaObject } = {}

		Object.keys(body).forEach(key => {
			properties[key] = convertResponseBodyToOpenApi(body[key], isResponseArray)
		})

		return {
			type: 'object',
			properties,
		}
	} else if (typeof body === 'string') {
		return { type: 'string' }
	} else if (typeof body === 'number') {
		return { type: 'number' }
	} else if (typeof body === 'boolean') {
		return { type: 'boolean' }
	}

	if (body && body.enum) {
		const enumValues = Object.values(body.enum)
		return { type: 'string', enum: enumValues }
	}

	return { type: 'object' }
}

const wrapResponseSchema = (responseEntitySchema?: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject => {
	const schema: OpenAPIV3.SchemaObject = {
		type: 'object',
		properties: {
			error: {
				type: 'object',
				nullable: true,
			},
		},
	}

	if (responseEntitySchema) {
		schema.properties.data = responseEntitySchema
	}

	return schema
}

const transformSchemaObjectToParameters = (schema: OpenAPIV3.SchemaObject, parameterType: string) => {
	const parameters: OpenAPIV3.ParameterObject[] = []

	Object.keys(schema.properties).forEach(key => {
		const property = schema.properties[key] as OpenAPIV3.SchemaObject
		const parameter: OpenAPIV3.ParameterObject = {
			name: key,
			in: parameterType,
			required: schema.required && schema.required.includes(key),
			schema: property,
		}

		if (property.type === 'array') {
			parameter.style = 'form'
			parameter.explode = true
		}

		parameters.push(parameter)
	})

	return parameters
}

const extractTagFromPath = (path: string): string => {
	const pathSegments = path.split('/')

	for (const segment of pathSegments) {
		if (segment.trim() !== '') {
			return segment.trim()
		}
	}

	return 'Uncategorized'
}

export const generatePathsSchema = (schemaRegistry: SchemaRegistry): OpenAPIV3.PathsObject => {
	const paths: OpenAPIV3.PathsObject = {}

	schemaRegistry.getAllSchemas().forEach((routeDetail: RouteDetails) => {
		const pathItem: OpenAPIV3.PathItemObject = paths[routeDetail.path] || {}
		const method = routeDetail.method.toLowerCase()
		const operation: OpenAPIV3.OperationObject = {
			summary: routeDetail.description,
			responses: {
				200: {
					description: 'Successful response',
					content: {
						'application/json': {
							schema: routeDetail.responseBody
								? wrapResponseSchema(convertResponseBodyToOpenApi(
									routeDetail.responseBody, routeDetail.isResponseArray
								))
								: wrapResponseSchema(),
						},
					},
				},
			},
		}

		operation.tags = [extractTagFromPath(routeDetail.path)]

		if (routeDetail.manualSchema) {
			operation.requestBody = {
				content: {
					'application/json': {
						schema: routeDetail.manualSchema,
					},
				},
			}
		} else if (routeDetail.validationSchema) {
			routeDetail.validationSchema.forEach(validation => {
				switch (validation.requestPart) {
					case RequestPart.BODY:
						operation.requestBody = {
							content: {
								'application/json': {
									schema: convert(validation.schema),
								},
							},
						}
						break
					case RequestPart.QUERY:
					case RequestPart.PARAMS: {
						operation.parameters = operation.parameters || []
						const parameterType = validation.requestPart === RequestPart.QUERY ? 'query' : 'path'
						const parameters = transformSchemaObjectToParameters(
							convert(validation.schema, parameterType),
							parameterType
						)
						operation.parameters.push(...parameters)
						break
					}
				}
			})
		}

		pathItem[method] = operation
		paths[routeDetail.path] = pathItem
	})

	return paths
}
