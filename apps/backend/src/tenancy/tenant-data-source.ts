import { DataSource, EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { requireTenantContext, runTenantSavepoint } from './tenant-context.service';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

const shardSources = new Map<string, DataSource>();

function scopedTransaction<T>(
  isolationOrCallback: IsolationLevel | ((manager: EntityManager) => Promise<T>),
  callback?: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (typeof isolationOrCallback === 'function') return runTenantSavepoint(isolationOrCallback);
  if (!callback) throw new Error('Transaction callback is required');
  return runTenantSavepoint(callback, isolationOrCallback);
}

export function registerTenantShard(id: string, source: DataSource): void {
  if (shardSources.has(id) && shardSources.get(id) !== source) throw new Error(`Duplicate data shard: ${id}`);
  shardSources.set(id, source);
}

export function getTenantShard(id: string): DataSource | undefined {
  return shardSources.get(id);
}

export function getTenantShards(): ReadonlyMap<string, DataSource> {
  return shardSources;
}

function scopedRepository<T extends ObjectLiteral>(source: DataSource, target: EntityTarget<T>): Repository<T> {
  const metadataRepository = source.getRepository(target);
  return new Proxy(metadataRepository, {
    get(repository, property) {
      if (property === 'target' || property === 'metadata' || property === 'constructor')
        return Reflect.get(repository, property);
      // Nest inspects then/lifecycle hooks while wiring providers. These are not
      // database operations and must remain harmless outside a tenant request.
      if (!Reflect.has(repository, property)) return undefined;
      if (property === 'manager') return scopedManager(source);
      const context = requireTenantContext();
      const current = context.manager.getRepository(target);
      const value: object | string | number | boolean | null | undefined = Reflect.get(current, property);
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}

function scopedManager(source: DataSource): EntityManager {
  return new Proxy(source.manager, {
    get(_manager, property) {
      if (property === 'constructor') return source.manager.constructor;
      if (!Reflect.has(source.manager, property)) return undefined;
      if (property === 'transaction') return scopedTransaction;
      const manager = requireTenantContext().manager;
      const value: object | string | number | boolean | null | undefined = Reflect.get(manager, property);
      return typeof value === 'function' ? value.bind(manager) : value;
    },
  });
}

/** Existing injected repositories resolve the current transaction at call time.
 * No business service receives a usable global manager or connection runner. */
export function tenantDataSource(source: DataSource): DataSource {
  registerTenantShard('data_1', source);
  return new Proxy(source, {
    get(target, property) {
      if (property === 'manager') return scopedManager(source);
      if (property === 'getRepository')
        return <T extends ObjectLiteral>(entity: EntityTarget<T>) => scopedRepository(source, entity);
      if (
        property === 'createQueryRunner' ||
        property === 'createEntityManager' ||
        property === 'getTreeRepository' ||
        property === 'getMongoRepository' ||
        property === 'getCustomRepository'
      ) {
        return () => {
          throw new Error('Use TenantDatabaseService and its transaction-scoped manager');
        };
      }
      if (property === 'transaction') return scopedTransaction;
      if (property === 'query' || property === 'createQueryBuilder') {
        const manager = requireTenantContext().manager;
        return manager[property].bind(manager);
      }
      const value: object | string | number | boolean | null | undefined = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
