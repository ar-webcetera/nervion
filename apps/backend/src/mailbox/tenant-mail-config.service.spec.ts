import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { parseTenantMailConfigurations, TenantMailConfigService, type TenantMailConfiguration } from './tenant-mail-config.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const route = '22222222-2222-4222-8222-222222222222';
const configuration: TenantMailConfiguration = {
  tenantId, domainOwnershipVerified: true, domains: ['mail.example.test'], notificationAccount: 'bot@mail.example.test',
  accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret', webhookRoutingKey: route, webhookSecret: 'test-only-webhook-secret-at-least-32-characters',
};
const tenant: TenantDescriptor = {
  id: tenantId, slug: 'client', hostname: 'client.example.test', status: TenantStatus.ACTIVE, databaseShardId: 'data_1',
  readOnly: false, featureFlags: { mail: true }, storageNamespace: `tenants/${tenantId}/`,
};

describe('tenant mail configuration', () => {
  it('rejects unverified, duplicate and cross-tenant domains', () => {
    expect(() => parseTenantMailConfigurations(JSON.stringify([{ ...configuration, domainOwnershipVerified: false }]))).toThrow();
    expect(() => parseTenantMailConfigurations(JSON.stringify([configuration, { ...configuration, tenantId: route, webhookRoutingKey: tenantId }]))).toThrow();
    expect(() => parseTenantMailConfigurations(JSON.stringify([{ ...configuration, notificationAccount: 'bot@another.test' }]))).toThrow();
  });

  it('does not fall back to process-wide credentials without tenant configuration', () => {
    const context = new TenantContextService();
    const service = new TenantMailConfigService(new ConfigService({ TENANCY_ENABLED: 'true', POSTBOX_ACCESS_KEY_ID: 'legacy' }), context, {} as PlatformService);
    expect(() => context.run({ tenant, manager: {} as EntityManager, active: true, afterCommit: [], afterRollback: [], pending: new Set() }, () => service.current())).toThrow('Почта пространства не настроена');
  });

  it('requires explicit mail opt-in and never lets a tenant send as another domain', () => {
    const context = new TenantContextService();
    const service = new TenantMailConfigService(new ConfigService({ TENANCY_ENABLED: 'true', MAILBOX_TENANTS_JSON: JSON.stringify([configuration]) }), context, {} as PlatformService);
    const run = (space: TenantDescriptor, sender: string) => context.run({ tenant: space, manager: {} as EntityManager, active: true, afterCommit: [], afterRollback: [], pending: new Set() }, () => service.assertSender(sender));
    expect(() => run(tenant, 'sender@other.test')).toThrow('подтвержденным');
    expect(() => run({ ...tenant, featureFlags: {} }, 'sender@mail.example.test')).toThrow('отключена');
    expect(() => run({ ...tenant, readOnly: true }, 'sender@mail.example.test')).toThrow('только для чтения');
    expect(() => run(tenant, 'sender@mail.example.test')).not.toThrow();
  });

  it('authenticates opaque routes before resolving a tenant and blocks read-only delivery', async () => {
    const getTenant = jest.fn().mockResolvedValue(tenant);
    const service = new TenantMailConfigService(new ConfigService({ TENANCY_ENABLED: 'true', MAILBOX_TENANTS_JSON: JSON.stringify([configuration]) }),
      new TenantContextService(), { getTenant } as object as PlatformService);
    await expect(service.authenticateWebhook(route, 'Bearer wrong')).rejects.toThrow('Неверный webhook');
    expect(getTenant).not.toHaveBeenCalled();
    await expect(service.authenticateWebhook(route, `Bearer ${configuration.webhookSecret}`)).resolves.toEqual(tenant);
    getTenant.mockResolvedValue({ ...tenant, readOnly: true });
    await expect(service.authenticateWebhook(route, `Bearer ${configuration.webhookSecret}`)).rejects.toThrow('временно недоступно');
    await expect(service.resolveRecipient('inbox@not-registered.test')).resolves.toBeNull();
  });
});
