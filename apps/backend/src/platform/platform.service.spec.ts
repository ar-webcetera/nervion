import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
import { PlatformTenant } from './entities/platform.platform-entity';
import { PlatformService } from './platform.service';

describe('platform tenant isolation and entitlements', () => {
  const tenantId = '36cb37c5-221c-487d-bca0-81ba6af2f7ca';
  const repository = { findOneBy: jest.fn() };
  const source = Object.assign(new DataSource({ type: 'postgres' }), { getRepository: jest.fn(() => repository) });
  const service = new PlatformService(source, new ConfigService({ TENANCY_ENABLED: 'true' }), {} as ModuleRef);
  let tenant: PlatformTenant;

  beforeEach(() => {
    jest.clearAllMocks();
    tenant = Object.assign(new PlatformTenant(), {
      id: tenantId,
      slug: 'client',
      hostname: 'client.nervion.ru',
      status: TenantStatus.ACTIVE,
      databaseShardId: 'data_1',
      storageNamespace: `tenants/${tenantId}/`,
      featureFlags: {},
      graceUntil: null,
    });
    repository.findOneBy.mockResolvedValue(tenant);
  });

  it('resolves only the exact registered hostname', async () => {
    const result = await service.resolveTenant('client.nervion.ru');
    expect(result.id).toBe(tenantId);
    expect(repository.findOneBy).toHaveBeenCalledWith({ hostname: 'client.nervion.ru' });
    await expect(service.resolveTenant('client.nervion.ru/other')).rejects.toThrow();
    expect(repository.findOneBy).toHaveBeenCalledTimes(1);
  });

  it('switches to read-only after the grace period and retains cancelled tenants as read-only', async () => {
    tenant.graceUntil = new Date(Date.now() - 1000);
    expect((await service.resolveTenant(tenant.hostname)).readOnly).toBe(true);
    tenant.graceUntil = new Date(Date.now() + 1000);
    expect((await service.resolveTenant(tenant.hostname)).readOnly).toBe(false);
    tenant.status = TenantStatus.CANCELLED;
    expect((await service.resolveTenant(tenant.hostname)).readOnly).toBe(true);
  });

  it.each([TenantStatus.SUSPENDED, TenantStatus.PROVISIONING, TenantStatus.FAILED])(
    'denies inaccessible tenant %s',
    async (status) => {
      tenant.status = status;
      await expect(service.resolveTenant(tenant.hostname)).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('rejects a token from another tenant before reading membership', async () => {
    await expect(
      service.assertSession(tenantId, 1, { tenantId: 'another-tenant', identityId: 'i', membershipId: 'm' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(source.getRepository).not.toHaveBeenCalled();
  });

  it('rejects legacy JWTs missing membership claims', async () => {
    await expect(service.assertSession(tenantId, 1, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(source.getRepository).not.toHaveBeenCalled();
  });

  it('binds session claims to the active membership identity', async () => {
    repository.findOneBy
      .mockResolvedValueOnce(tenant)
      .mockResolvedValueOnce({
        id: 'membership',
        tenantId,
        identityId: 'identity',
        localUserId: 1,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce({ id: 'identity', emailVerifiedAt: new Date(), sessionVersion: 1 });
    await expect(
      service.assertSession(tenantId, 1, {
        tenantId,
        membershipId: 'membership',
        identityId: 'other-identity',
        identityVersion: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
