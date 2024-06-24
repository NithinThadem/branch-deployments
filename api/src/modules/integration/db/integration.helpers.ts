/* eslint-disable max-len */
import dataSource from '../../../services/database/data-source'
import { IntegrationEntity } from './integration.entity'

export const getIntegrationByNangoMetadata = async (key: string, value: string) => {
	const integration = await dataSource
		.createQueryBuilder()
		.select('integration')
		.from(IntegrationEntity, 'integration')
		.where('integration.auth_metadata -> \'nango_connection_config\' ->> :key = :value', { key, value })
		.getOne()

	if (!integration && key === 'locationId') {
		const integrationWithLocation = await dataSource
			.createQueryBuilder()
			.select('integration')
			.from(IntegrationEntity, 'integration')
			.where('integration.auth_metadata -> \'nango_connection_config\' -> \'locations\' @> :location', { location: JSON.stringify([{ id: value }]) })
			.getOne()

		return integrationWithLocation
	}

	return integration
}
