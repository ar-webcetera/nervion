import type { TenantDescriptor } from '@tracker/contracts';
import { TenantStatus } from '@tracker/contracts';
import type { EntityManager } from 'typeorm';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantJob, TenantJobsService } from './tenant-jobs.service';

describe('tenant job dispatch boundaries', () => {
  const context = new TenantContextService();
  const tenant: TenantDescriptor = {
    id: 'a',
    slug: 'a',
    hostname: 'a.example.test',
    status: TenantStatus.ACTIVE,
    databaseShardId: 'data_1',
    featureFlags: {},
    readOnly: false,
    storageNamespace: 'tenants/a',
  };
  const manager = {
    query: jest.fn(),
    transaction: (work: (entityManager: EntityManager) => Promise<void>) => work(manager as object as EntityManager),
  };
  const platform = { listRunnableTenants: jest.fn(), getTenant: jest.fn() };
  const database = {
    run: jest.fn((selected: TenantDescriptor, work: () => Promise<boolean | void>) =>
      context.run(
        {
          tenant: selected,
          manager: manager as object as EntityManager,
          active: true,
          afterCommit: [],
          afterRollback: [],
          pending: new Set(),
        },
        work,
      ),
    ),
  };
  let service: TenantJobsService;
  let queued: TenantJob[];
  beforeEach(() => {
    jest.clearAllMocks();
    platform.listRunnableTenants.mockResolvedValue([tenant]);
    platform.getTenant.mockResolvedValue(tenant);
    queued = [];
    manager.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve([{ acquired: true }]);
      if (sql.includes('SELECT * FROM tenant_jobs')) return Promise.resolve(queued.splice(0, 1));
      return Promise.resolve([]);
    });
    service = new TenantJobsService(context, database as object as TenantDatabaseService, platform as object as PlatformService);
  });

  it('selects only kinds supported by this process', async () => {
    service.register('healthchecks.probe', async () => undefined);
    await service.tick();
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('kind = ANY($1::text[])'), [['healthchecks.probe']]);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(false);
  });

  it('does not claim jobs when this process has no handlers', async () => {
    await service.tick();
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('SELECT * FROM tenant_jobs'))).toBe(false);
  });

  it('runs one job per tenant per round instead of draining the first customer', async () => {
    const tenants = [tenant, { ...tenant, id: 'b', slug: 'b', hostname: 'b.example.test' }];
    const counts = new Map([
      ['a', 2],
      ['b', 2],
    ]);
    const order: string[] = [];
    platform.listRunnableTenants.mockResolvedValue(tenants);
    platform.getTenant.mockImplementation(async (id: string) => tenants.find((item) => item.id === id));
    manager.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve([{ acquired: true }]);
      if (!sql.includes('SELECT * FROM tenant_jobs')) return Promise.resolve([]);
      const id = context.require().tenant.id;
      const count = counts.get(id) ?? 0;
      if (!count) return Promise.resolve([]);
      counts.set(id, count - 1);
      return Promise.resolve([
        {
          id: `${id}-${count}`,
          tenant_id: id,
          database_shard_id: 'data_1',
          actor_id: null,
          kind: 'probe',
          payload: {},
          attempts: 0,
          idempotency_key: `${id}-${count}`,
        },
      ]);
    });
    service.register('probe', async () => {
      order.push(context.require().tenant.id);
    });
    await service.tick();
    expect(order).toEqual(['a', 'b', 'a', 'b']);
  });

  it('checks current read-only state instead of trusting the initial tenant listing', async () => {
    platform.getTenant.mockResolvedValue({ ...tenant, readOnly: true });
    service.register('healthchecks.probe', async () => undefined);
    await service.tick();
    expect(database.run).not.toHaveBeenCalled();
  });

  it('rejects a job routed to a different shard', async () => {
    const handler = jest.fn();
    service.register('healthchecks.probe', handler);
    queued.push({
      id: 'bad-job',
      tenant_id: tenant.id,
      database_shard_id: 'data_2',
      kind: 'healthchecks.probe',
      actor_id: 1,
      attempts: 0,
      idempotency_key: 'a',
      payload: {},
    });
    await service.tick();
    expect(handler).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), ['bad-job']);
  });

  it('restores the actor inside a tenant transaction and checks state again before the next job', async () => {
    const observed: Array<{ tenant: string; actor: number | undefined }> = [];
    service.register('healthchecks.probe', async () => {
      observed.push({ tenant: context.require().tenant.id, actor: context.require().actorId });
      platform.getTenant.mockResolvedValue({ ...tenant, readOnly: true });
    });
    queued.push({
      id: 'job',
      tenant_id: tenant.id,
      database_shard_id: tenant.databaseShardId,
      kind: 'healthchecks.probe',
      actor_id: 7,
      attempts: 0,
      idempotency_key: 'a',
      payload: {},
    });
    await service.tick();
    expect(observed).toEqual([{ tenant: 'a', actor: 7 }]);
    expect(platform.getTenant).toHaveBeenCalledTimes(3);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("status = 'completed'"), ['job']);
  });
});
