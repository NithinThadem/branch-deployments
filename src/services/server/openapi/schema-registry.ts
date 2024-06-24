import Joi from 'joi'
import { RequestPart } from '../../../types'
import { OpenAPIV3 } from 'openapi-types'

interface ValidationSchema {
	schema: Joi.Schema
	requestPart: RequestPart
}

export interface RouteDetails {
	method: string;
	path: string;
	validationSchema?: ValidationSchema[];
	manualSchema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
	responseBody?: any;
	isResponseArray?: boolean;
	description?: string;
}

class SchemaRegistry {

	private schemas: RouteDetails[] = []

	addSchema(schema: RouteDetails) {
		this.schemas.push(schema)
	}

	getAllSchemas() {
		return this.schemas
	}

}

export default SchemaRegistry
