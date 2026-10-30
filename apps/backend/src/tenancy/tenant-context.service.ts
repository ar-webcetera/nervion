import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import type { TenantDescriptor } from '@tracker/contracts';

export interface TenantExecutionContext {
  tenant: TenantDescriptor;
  manager: EntityManager;
  actorId?: number;
  active: boolean;
  afterCommit: Array<() => Promise<void>>;
  afterRollback: Array<() => Promise<void>>;
  pending: Set<Promise<void>>;
}

// One store is shared by the TypeORM factory and Nest providers. It contains no
// default tenant: work outside a request/job must explicitly enter a context.
export const tenantStorage = new AsyncLocalStorage<TenantExecutionContext>();

export function requireTenantContext(): TenantExecutionContext {
  const context = tenantStorage.getStore();
  if (!context?.active || context.manager.queryRunner?.isReleased) {
    throw new ServiceUnavailableException('Контекст пространства не установлен или уже закрыт');
  }
  return context;
}

/** Keep deliberately detached application work inside the request transaction. */
export function trackTenantPromise<T>(work: Promise<T>): Promise<T> {
  const context = tenantStorage.getStore();
  if (context?.active) {
    const pending = work.then(() => undefined);
    // The runner awaits the original rejection before commit. Attach a handler
    // immediately so a fast rejection is not reported as unhandled meanwhile.
    void pending.catch(() => undefined);
    context.pending.add(pending);
  }
  return work;
}

export async function drainTenantWork(context: TenantExecutionContext): Promise<void> {
  let failure: PromiseRejectedResult | undefined;
  while (context.pending.size) {
    const pending = [...context.pending];
    context.pending.clear();
    const results = await Promise.allSettled(pending);
    failure ??= results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  }
  if (failure) throw failure.reason;
}

export async function runTenantSavepoint<T>(
  callback: (manager: EntityManager) => Promise<T>,
  isolation?: IsolationLevel,
): Promise<T> {
  const parent = requireTenantContext();
  const child: TenantExecutionContext = {
    ...parent,
    afterCommit: [],
    afterRollback: [],
    pending: new Set(),
  };
  const run = async (manager: EntityManager): Promise<T> => {
    child.manager = manager;
    return tenantStorage.run(child, async () => {
      try {
        return await callback(manager);
      } finally {
        await drainTenantWork(child);
      }
    });
  };
  try {
    const result = isolation ? await parent.manager.transaction(isolation, run) : await parent.manager.transaction(run);
    parent.afterCommit.push(...child.afterCommit);
    parent.afterRollback.push(...child.afterRollback);
    return result;
  } catch (error) {
    for (const hook of child.afterRollback.slice().reverse()) {
      try {
        await hook();
      } catch {
        new Logger('TenantTransaction').error('Savepoint rollback hook failed');
      }
    }
    throw error;
  } finally {
    child.active = false;
  }
}

@Injectable()
export class TenantContextService {
  isEnabled(): boolean {
    return process.env.TENANCY_ENABLED === 'true';
  }

  current(): TenantExecutionContext | undefined {
    return tenantStorage.getStore();
  }

  require(): TenantExecutionContext {
    return requireTenantContext();
  }

  run<T>(context: TenantExecutionContext, callback: () => T): T {
    return tenantStorage.run(context, callback);
  }
}
