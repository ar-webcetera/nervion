import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
export interface PlatformAuditDetails {
  [key: string]: string | number | boolean | null | Record<string, boolean>;
}

export interface PlatformMfaSettings {
  enabled?: boolean;
  totpSecretRef?: string;
}

@Entity('platform_tenants')
export class PlatformTenant {
  @PrimaryColumn('uuid') id: string;
  @Column({ unique: true }) slug: string;
  @Column({ unique: true }) hostname: string;
  @Column() name: string;
  @Column({ type: 'varchar' }) status: TenantStatus;
  @Column() plan: string;
  @Column({ name: 'seat_limit', type: 'integer' }) seatLimit: number;
  @Column({ name: 'paid_until', type: 'timestamptz', nullable: true }) paidUntil: Date | null;
  @Column({ name: 'grace_until', type: 'timestamptz', nullable: true }) graceUntil: Date | null;
  @Column({ name: 'retention_until', type: 'timestamptz', nullable: true }) retentionUntil: Date | null;
  @Column({ name: 'database_shard_id' }) databaseShardId: string;
  @Column({ name: 'storage_namespace' }) storageNamespace: string;
  @Column({ name: 'feature_flags', type: 'jsonb', default: {} }) featureFlags: Record<string, boolean>;
  @Column({ name: 'provisioning_admin', type: 'jsonb', nullable: true }) provisioningAdmin: {
    identityId: string;
    firstName: string;
    lastName: string;
  } | null;
  @Column({ name: 'provisioning_error', type: 'text', nullable: true }) provisioningError: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('platform_identities')
export class PlatformIdentity {
  @PrimaryColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column({ name: 'password_hash', nullable: true, type: 'text', select: false }) passwordHash: string | null;
  @Column({ name: 'credential_origin_tenant_id', type: 'uuid', nullable: true }) credentialOriginTenantId: string | null;
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true }) emailVerifiedAt: Date | null;
  @Column({ name: 'session_version', type: 'integer', default: 1 }) sessionVersion: number;
  @Column({ name: 'mfa_settings', type: 'jsonb', default: {} }) mfaSettings: PlatformMfaSettings;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('platform_memberships')
export class PlatformMembership {
  identityVersion?: number;
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'identity_id', type: 'uuid' }) identityId: string;
  @Column({ name: 'local_user_id', type: 'integer', nullable: true }) localUserId: number | null;
  @Column() role: string;
  @Column({ type: 'varchar' }) status: MembershipStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('platform_audit')
export class PlatformAudit {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column() actor: string;
  @Column() action: string;
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true }) tenantId: string | null;
  @Column({ type: 'jsonb', default: {} }) details: PlatformAuditDetails;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('platform_admin_sessions')
export class PlatformAdminSession {
  @PrimaryColumn({ name: 'token_hash', type: 'varchar' }) tokenHash: string;
  @Column() email: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
}

export const PLATFORM_ENTITIES = [PlatformTenant, PlatformIdentity, PlatformMembership, PlatformAudit, PlatformAdminSession];
