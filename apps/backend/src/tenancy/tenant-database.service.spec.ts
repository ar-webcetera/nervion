import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { TenantContextService, requireTenantContext, trackTenantPromise } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { getTenantShard, getTenantShards } from './tenant-data-source';

jest.mock('./tenant-data-source', () => ({
  getTenantShard: jest.fn(),
  getTenantShards: jest.fn(),
  registerTenantShard: jest.fn(),
}));

describe('Tenant transaction lifecycle', () => {
  const previous = process.env.TENANCY_ENABLED;
  const previousShards = process.env.DATA_SHARDS_JSON;
  const tenant: TenantDescriptor = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'a',
    hostname: 'a.nervion.ru',
    status: TenantStatus.ACTIVE,
    databaseShardId: 'data_1',
    readOnly: false,
    featureFlags: {},
    storageNamespace: 'tenants/a',
  };
  let events: string[];
  let runner: QueryRunner;
  let rollbackMock: jest.Mock<Promise<void>, []>;
  let service: TenantDatabaseService;
  beforeEach(() => {
    process.env.TENANCY_ENABLED = 'true';
    process.env.DATA_SHARDS_JSON = '[]';
    events = [];
    rollbackMock = jest.fn(() => {
      events.push('rollback');
      return Promise.resolve();
    });
    runner = {
      manager: {} as EntityManager,
      isTransactionActive: true,
      isReleased: false,
      connect: jest.fn(() => {
        events.push('connect');
        return Promise.resolve();
      }),
      startTransaction: jest.fn(() => {
        events.push('begin');
        return Promise.resolve();
      }),
      query: jest.fn(() => {
        events.push('context');
        return Promise.resolve();
      }),
      commitTransaction: jest.fn(() => {
        events.push('commit');
        return Promise.resolve();
      }),
      rollbackTransaction: rollbackMock,
      release: jest.fn(() => {
        events.push('release');
        return Promise.resolve();
      }),
    } as object as QueryRunner;
    jest.mocked(getTenantShard).mockReturnValue({ createQueryRunner: () => runner } as object as DataSource);
    jest.mocked(getTenantShards).mockReturnValue(new Map());
    service = new TenantDatabaseService(new TenantContextService());
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TENANCY_ENABLED;
    else process.env.TENANCY_ENABLED = previous;
    if (previousShards === undefined) delete process.env.DATA_SHARDS_JSON;
    else process.env.DATA_SHARDS_JSON = previousShards;
  });

  it('drains detached work and releases the connection before after-commit hooks', async () => {
    const result = await service.run(tenant, () => {
      events.push('body');
      void trackTenantPromise(
        Promise.resolve().then(() => {
          events.push('audit');
        }),
      );
      requireTenantContext().afterCommit.push(() => {
        expect(events).toContain('release');
        events.push('event');
        return Promise.resolve();
      });
      return Promise.resolve('saved');
    });
    expect(result).toBe('saved');
    expect(events).toEqual(['connect', 'begin', 'context', 'body', 'audit', 'commit', 'release', 'event']);
  });

  it('rolls back and releases on handler failure, running cleanup but no events', async () => {
    await expect(
      service.run(tenant, () => {
        requireTenantContext().afterCommit.push(() => {
          events.push('event');
          return Promise.resolve();
        });
        requireTenantContext().afterRollback.push(() => {
          events.push('cleanup');
          return Promise.resolve();
        });
        return Promise.reject(new Error('handler error'));
      }),
    ).rejects.toThrow('handler error');
    expect(events).toEqual(['connect', 'begin', 'context', 'rollback', 'release', 'cleanup']);
  });

  it('rejects tenant switching inside a transaction', async () => {
    await expect(service.run(tenant, () => service.run({ ...tenant, id: 'other' }, () => Promise.resolve()))).rejects.toThrow(
      'Смена пространства',
    );
    expect(rollbackMock).toHaveBeenCalledTimes(1);
  });

  it('does not turn a committed mutation into a failed response when an event hook fails', async () => {
    await expect(
      service.run(tenant, () => {
        requireTenantContext().afterCommit.push(() => {
          return Promise.reject(new Error('delivery failed'));
        });
        return Promise.resolve(42);
      }),
    ).resolves.toBe(42);
    expect(rollbackMock).not.toHaveBeenCalled();
  });

  it('rejects runtime roles with schema or database CREATE privileges at startup', async () => {
    const query = jest.fn(() => Promise.resolve([{ unsafe: true }]));
    const source = { query } as object as DataSource;
    jest.mocked(getTenantShard).mockReturnValue(source);
    jest.mocked(getTenantShards).mockReturnValue(new Map([['data_1', source]]));
    await expect(service.onApplicationBootstrap()).rejects.toThrow('Unsafe database runtime role');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("has_schema_privilege('public', 'CREATE')"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("has_database_privilege(current_database(), 'CREATE')"));
  });

  it('closes initialized additional shard pools but leaves the primary pool to Nest', async () => {
    const primaryDestroy = jest.fn(() => Promise.resolve());
    const extraDestroy = jest.fn(() => Promise.resolve());
    const stoppedDestroy = jest.fn(() => Promise.resolve());
    jest.mocked(getTenantShards).mockReturnValue(
      new Map([
        ['data_1', { isInitialized: true, destroy: primaryDestroy } as object as DataSource],
        ['data_2', { isInitialized: true, destroy: extraDestroy } as object as DataSource],
        ['data_3', { isInitialized: false, destroy: stoppedDestroy } as object as DataSource],
      ]),
    );
    await service.onApplicationShutdown();
    expect(extraDestroy).toHaveBeenCalledTimes(1);
    expect(primaryDestroy).not.toHaveBeenCalled();
    expect(stoppedDestroy).not.toHaveBeenCalled();
  });
});
