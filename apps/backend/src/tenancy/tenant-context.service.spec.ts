import { DataSource, EntityManager, Repository } from 'typeorm';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import {
  drainTenantWork,
  requireTenantContext,
  runTenantSavepoint,
  tenantStorage,
  trackTenantPromise,
  type TenantExecutionContext,
} from './tenant-context.service';
import { tenantDataSource } from './tenant-data-source';

const tenant = (id: string): TenantDescriptor => ({
  id,
  slug: id,
  hostname: `${id}.nervion.ru`,
  status: TenantStatus.ACTIVE,
  databaseShardId: 'data_1',
  readOnly: false,
  featureFlags: {},
  storageNamespace: `tenants/${id}`,
});
const state = (id: string, manager = {} as EntityManager): TenantExecutionContext => ({
  tenant: tenant(id),
  manager,
  active: true,
  afterCommit: [],
  afterRollback: [],
  pending: new Set(),
});

describe('Tenant async context and transaction proxies', () => {
  it('isolates concurrent async operations and rejects work after context closes', async () => {
    const a = state('a');
    const b = state('b');
    let resumeA: () => void = () => undefined;
    const waitA = new Promise<void>((resolve) => {
      resumeA = resolve;
    });
    await Promise.all([
      tenantStorage.run(a, async () => {
        await waitA;
        expect(requireTenantContext().tenant.id).toBe('a');
      }),
      tenantStorage.run(b, async () => {
        await Promise.resolve();
        expect(requireTenantContext().tenant.id).toBe('b');
        resumeA();
      }),
    ]);
    expect(() => requireTenantContext()).toThrow();
    a.active = false;
    tenantStorage.run(a, () => expect(() => requireTenantContext()).toThrow());
  });

  it('cannot query through an injected data source or repository without a context', async () => {
    const repository = { find: jest.fn(() => Promise.resolve([{ id: 1 }])), target: 'Tasks' } as Partial<
      Repository<{ id: number }>
    >;
    const source = {
      manager: {},
      getRepository: jest.fn(() => repository),
    } as object as DataSource;
    const scoped = tenantDataSource(source);
    const injected = scoped.getRepository('Tasks');
    await expect(Promise.resolve(injected)).resolves.toBe(injected);
    expect(Reflect.get(injected, 'onModuleInit')).toBeUndefined();
    expect(Reflect.get(injected, 'onApplicationBootstrap')).toBeUndefined();
    expect(Reflect.get(scoped.manager, 'then')).toBeUndefined();
    expect(() => injected.find()).toThrow();
    expect(() => scoped.query('SELECT 1')).toThrow();
    expect(() => scoped.createQueryRunner()).toThrow();
    const contextual = { getRepository: jest.fn(() => repository) } as object as EntityManager;
    await tenantStorage.run(state('a', contextual), async () => {
      expect(await injected.find()).toEqual([{ id: 1 }]);
    });
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('waits for all tracked work even after one pending operation fails', async () => {
    const current = state('a');
    const finished: string[] = [];
    await tenantStorage.run(current, async () => {
      void trackTenantPromise(
        Promise.resolve().then(() => {
          throw new Error('audit failed');
        }),
      ).catch(() => undefined);
      void trackTenantPromise(
        Promise.resolve().then(async () => {
          await Promise.resolve();
          finished.push('second');
          void trackTenantPromise(
            Promise.resolve().then(() => {
              finished.push('nested');
            }),
          );
        }),
      );
      await expect(drainTenantWork(current)).rejects.toThrow('audit failed');
      expect(finished).toEqual(['second', 'nested']);
      expect(current.pending.size).toBe(0);
    });
  });

  it('discards commit hooks on failed savepoint and propagates hooks on success', async () => {
    const nestedManager = {} as EntityManager;
    const manager = {
      transaction: jest.fn(async (callback: (em: EntityManager) => Promise<void>) => callback(nestedManager)),
    } as object as EntityManager;
    const parent = state('a', manager);
    const commit = jest.fn(() => Promise.resolve());
    const cleanup = jest.fn(() => Promise.resolve());
    await tenantStorage.run(parent, async () => {
      await expect(
        runTenantSavepoint(() => {
          expect(requireTenantContext().manager).toBe(nestedManager);
          requireTenantContext().afterCommit.push(commit);
          requireTenantContext().afterRollback.push(cleanup);
          return Promise.reject(new Error('handler failed'));
        }),
      ).rejects.toThrow('handler failed');
      expect(parent.afterCommit).toHaveLength(0);
      expect(parent.afterRollback).toHaveLength(0);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
      expect(requireTenantContext()).toBe(parent);
      await runTenantSavepoint(() => {
        requireTenantContext().afterCommit.push(commit);
        requireTenantContext().afterRollback.push(cleanup);
        return Promise.resolve();
      });
      expect(parent.afterCommit).toEqual([commit]);
      expect(parent.afterRollback).toEqual([cleanup]);
    });
  });
});
