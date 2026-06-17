import { AuditActionType, AuditEntityType, AuditSourceType } from '@tracker/contracts';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { JsonObject } from '../../common/types/json';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'audit_logs' })
@Index(['created_at'])
@Index(['actor_id'])
@Index(['action_type'])
@Index(['entity_type'])
@Index(['project_id'])
@Index(['task_id'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: AuditActionType, name: 'action_type' })
  action_type: AuditActionType;

  @Column({ type: 'enum', enum: AuditEntityType, name: 'entity_type' })
  entity_type: AuditEntityType;

  @Column({ type: 'varchar', length: 128, name: 'entity_id', nullable: true })
  entity_id: string | null;

  @Column({ type: 'varchar', length: 255, name: 'entity_label', nullable: true })
  entity_label: string | null;

  @Column({ type: 'varchar', length: 500 })
  summary: string;

  @Column({ type: 'jsonb', name: 'before_payload', nullable: true })
  before_payload: JsonObject | null;

  @Column({ type: 'jsonb', name: 'after_payload', nullable: true })
  after_payload: JsonObject | null;

  @Column({ type: 'jsonb', name: 'diff_payload', nullable: true })
  diff_payload: JsonObject | null;

  @Column({ type: 'jsonb', name: 'metadata_payload', nullable: true })
  metadata_payload: JsonObject | null;

  @Column({ type: 'enum', enum: AuditSourceType, name: 'source_type', default: AuditSourceType.WEB })
  source_type: AuditSourceType;

  @Column({ type: 'int', name: 'actor_id', nullable: true })
  actor_id: number | null;

  @Column({ type: 'varchar', length: 255, name: 'actor_name', nullable: true })
  actor_name: string | null;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: Users | null;

  @Column({ type: 'int', name: 'project_id', nullable: true })
  project_id: number | null;

  @Column({ type: 'int', name: 'task_id', nullable: true })
  task_id: number | null;

  @Column({ type: 'varchar', length: 64, name: 'request_id', nullable: true })
  request_id: string | null;

  @Column({ type: 'varchar', length: 16, name: 'request_method', nullable: true })
  request_method: string | null;

  @Column({ type: 'varchar', length: 512, name: 'request_path', nullable: true })
  request_path: string | null;

  @Column({ type: 'varchar', length: 64, name: 'ip_address', nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  user_agent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;
}
