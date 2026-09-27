import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CrmActivityKind, CrmStageKind, type JsonObject } from '@tracker/contracts';

@Entity('crm_companies')
export class CrmCompanyEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ default: '' }) legal_name: string;
  @Column({ default: '' }) inn: string;
  @Column({ default: '' }) website: string;
  @Column({ type: 'text', default: '' }) notes: string;
  @Column({ type: 'int', nullable: true }) responsible_id: number | null;
}
@Entity('crm_contacts')
export class CrmContactEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ type: 'int', nullable: true }) company_id: number | null;
  @Column({ default: '' }) position: string;
  @Column({ default: '' }) phone: string;
  @Column({ default: '' }) email: string;
  @Column({ default: '' }) telegram: string;
}
@Entity('crm_stages')
export class CrmStageEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column() position: number;
  @Column({ type: 'varchar' }) kind: CrmStageKind;
}
@Entity('crm_deals')
export class CrmDealEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column() stage_id: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true }) amount: string | null;
  @Column({ type: 'int', nullable: true }) company_id: number | null;
  @Column({ type: 'int', array: true, default: '{}' }) contact_ids: number[];
  @Column({ type: 'int', nullable: true }) primary_contact_id: number | null;
  @Column({ type: 'int', nullable: true }) responsible_id: number | null;
  @Column({ default: '' }) source: string;
  @Column({ type: 'date', nullable: true }) expected_close: string | null;
  @Column({ type: 'int', nullable: true }) project_id: number | null;
  @Column({ type: 'jsonb', nullable: true }) description: JsonObject | null;
  @Column({ type: 'text', nullable: true }) loss_reason: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
@Entity('crm_activities')
export class CrmActivityEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() deal_id: number;
  @Column({ type: 'varchar' }) kind: CrmActivityKind;
  @Column({ type: 'jsonb', nullable: true }) message: JsonObject | null;
  @Column({ type: 'text', default: '' }) summary: string;
  @Column() author_name: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}
