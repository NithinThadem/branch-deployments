import { TeamEntity } from '../../team/db/team.entity'
import { UserEntity } from '../../user/db/user.entity'
import {
	BaseEntity, Entity, PrimaryGeneratedColumn, CreateDateColumn, Column, ManyToOne, JoinColumn,
	Index,
} from 'typeorm'

@Entity({ name: 'audit_logs' })
@Index('idx_audit_logs_teamid_userid_actiontype', ['team_id', 'user_id', 'action_type'])
export class AuditLogEntity extends BaseEntity {

    @PrimaryGeneratedColumn('uuid')
    id: string

    @CreateDateColumn({ name: 'timestamp', type: 'timestamp with time zone' })
	timestamp: Date

    @Index('idx_audit_logs_userid')
    @Column({ name: 'user_id' })
    user_id: string

    @ManyToOne(() => UserEntity, user => user.audit_logs, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity

    @Column({ name: 'team_id' })
    team_id: string

    @ManyToOne(() => TeamEntity, team => team.audit_logs, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'team_id' })
    team: TeamEntity

    @Column({ type: 'varchar', length: 50 })
    @Index('idx_audit_logs_actiontype')
    action_type: string

    @Column({ type: 'varchar', length: 255 })
    resource: string

    @Column({ type: 'jsonb' })
    details: Record<string, string | object>

    @Column({ type: 'uuid' })
    session_id: string

}
