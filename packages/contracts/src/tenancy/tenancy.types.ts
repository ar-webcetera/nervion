import { MembershipStatus, TenantStatus } from './tenancy.enums';

export interface TenantDescriptor {
  id: string;
  slug: string;
  hostname: string;
  status: TenantStatus;
  databaseShardId: string;
  readOnly: boolean;
  featureFlags: Record<string, boolean>;
  storageNamespace: string;
}

export interface PlatformTenantSummary extends TenantDescriptor {
  name: string;
  plan: string;
  seatLimit: number;
  activeSeats: number;
  paidUntil: string | null;
  graceUntil: string | null;
  retentionUntil: string | null;
  provisioningError: string | null;
  createdAt: string;
}

export interface CreatePlatformTenantRequest {
  slug: string;
  name: string;
  plan: string;
  seatLimit: number;
  paidUntil: string | null;
  featureFlags: Record<string, boolean>;
  admin: { email: string; firstName: string; lastName: string; password: string; emailOwnershipVerified?: boolean };
}

export interface UpdatePlatformTenantRequest {
  name?: string;
  plan?: string;
  seatLimit?: number;
  paidUntil?: string | null;
  status?: TenantStatus;
  featureFlags?: Record<string, boolean>;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  identityId: string;
  localUserId: number | null;
  role: string;
  status: MembershipStatus;
}

export interface TenantSessionClaims {
  tenantId: string;
  identityId: string;
  membershipId: string;
  identityVersion: number;
}

export interface VerifyPlatformIdentityRequest {
  email: string;
  newPassword: string;
  verifiedOwnership: boolean;
}
