import {
	Entity, Column, PrimaryGeneratedColumn, ManyToMany, Index, BaseEntity,
} from 'typeorm'
import { ContactEntity } from '../../contact/db/contact.entity'

@Entity({ name: 'contact_tag' })
export class ContactTagEntity extends BaseEntity {

	@PrimaryGeneratedColumn('uuid')
	id: string

	@Index()
	@Column({ type: 'varchar', length: 255 })
	name: string

	@ManyToMany(() => ContactEntity, contact => contact.tags)
	contacts: ContactEntity[]

}
