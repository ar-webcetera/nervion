import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { CreatePlatformTenantRequest, MembershipStatus, TenantStatus } from '@tracker/contracts';
import { PlatformTenant } from './entities/platform.platform-entity';
import { PlatformService } from './platform.service';
import { CreatePlatformTenantDto, UpdatePlatformTenantDto } from './dto/platform-tenant.dto';

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

  const createInput = (slug: string): CreatePlatformTenantRequest => ({
    slug,
    name: 'Fixture tenant',
    plan: 'fixture',
    seatLimit: 5,
    paidUntil: null,
    featureFlags: {},
    admin: {
      email: 'fixture@example.test',
      firstName: 'Fixture',
      lastName: 'Admin',
      password: 'fixture-only-password',
    },
  });

  it.each(['admin', 'auth', 'api', 'app', 'preprod', 'www', 'mail', 'smtp', 'media', 'status', 'static'])(
    'rejects infrastructure slug %s before any provisioning or database access',
    async (slug) => {
      await expect(service.createTenant(createInput(slug), 'operator')).rejects.toBeInstanceOf(BadRequestException);
      expect(source.getRepository).not.toHaveBeenCalled();
    },
  );

  it.each(['slug', 'hostname'])('does not expose an update path for %s', async (field) => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(
      pipe.transform(
        { name: 'Allowed display name', [field]: field === 'slug' ? 'app' : 'app.nervion.ru' },
        {
          type: 'body',
          metatype: UpdatePlatformTenantDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.getRepository).not.toHaveBeenCalled();
  });

  it('does not let a create caller override the generated hostname', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(
      pipe.transform(
        { ...createInput('client'), hostname: 'app.nervion.ru' },
        {
          type: 'body',
          metatype: CreatePlatformTenantDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.getRepository).not.toHaveBeenCalled();
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
