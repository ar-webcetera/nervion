import { Injectable } from '@nestjs/common';
import type { AuditSourceType } from '@tracker/contracts';
import { AsyncLocalStorage } from 'async_hooks';

export interface AuditActorContext {
  id: number;
  name: string;
}

export interface AuditContextState {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string;
  requestPath: string;
  sourceType: AuditSourceType;
  actor?: AuditActorContext | null;
}

@Injectable()
export class AuditContextService {
  private readonly storage = new AsyncLocalStorage<AuditContextState>();

  run<T>(state: AuditContextState, callback: () => T): T {
    return this.storage.run(state, callback);
  }

  getState(): AuditContextState | undefined {
    return this.storage.getStore();
  }

  setActor(actor: AuditActorContext | null, sourceType?: AuditSourceType) {
    const state = this.storage.getStore();
    if (!state) return;

    state.actor = actor;
    if (sourceType) {
      state.sourceType = sourceType;
    }
  }
}
