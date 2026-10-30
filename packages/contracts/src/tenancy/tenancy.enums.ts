export enum TenantStatus {
  PROVISIONING = 'provisioning',
  ACTIVE = 'active',
  READ_ONLY = 'read_only',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export enum MembershipStatus {
  RESERVED = 'reserved',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}
