import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JsonObject } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { runTenantSavepoint, TenantContextService, tenantStorage } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';

export interface TenantJob {
  id: string;
  tenant_id: string;
  database_shard_id: string;
  actor_id: number | null;
  idempotency_key: string;
  kind: string;
  payload: JsonObject;
  attempts: number;
}

@Injectable()
export class TenantJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TenantJobsService.name);
  private readonly handlers = new Map<string, (job: TenantJob) => Promise<void>>();
  private readonly schedules = new Map<string, () => Promise<void>>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly context: TenantContextService,
    private readonly database: TenantDatabaseService,
    private readonly platform: PlatformService,
  ) {}

  register(kind: string, handler: (job: TenantJob) => Promise<void>): void {
    if (this.handlers.has(kind)) throw new Error(`Duplicate job handler: ${kind}`);
    this.handlers.set(kind, handler);
  }

  schedule(name: string, callback: () => Promise<void>): void {
    if (this.schedules.has(name)) throw new Error(`Duplicate job schedule: ${name}`);
    this.schedules.set(name, callback);
  }

  async enqueue(kind: string, idempotencyKey: string, payload: JsonObject = {}): Promise<void> {
    const { tenant, manager, actorId } = this.context.require();
    if (tenant.readOnly) return;
    if (!this.handlers.has(kind) || !idempotencyKey || idempotencyKey.length > 200) throw new Error('Invalid tenant job');
    await manager.query(
      `
      INSERT INTO tenant_jobs (id, tenant_id, database_shard_id, actor_id, idempotency_key, kind, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    `,
      [randomUUID(), tenant.id, tenant.databaseShardId, actorId ?? null, idempotencyKey, kind, JSON.stringify(payload)],
    );
  }

  onApplicationBootstrap(): void {
    if (!this.context.isEnabled() || process.env.TENANT_JOBS_WORKER_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    return tenantStorage.exit(() => this.tickDetached());
  }

  private async tickDetached(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.platform.listRunnableTenants();
      const ready: string[] = [];
      for (const snapshot of tenants) {
        try {
          const tenant = await this.platform.getTenant(snapshot.id);
          if (tenant.readOnly) continue;
          await this.database.run(tenant, async () => {
            const manager = this.context.require().manager;
            const locks = await manager.query<Array<{ acquired: boolean }>>(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
              [`${tenant.id}:scheduler`],
            );
            if (!locks[0]?.acquired) return;
            for (const callback of this.schedules.values()) await callback();
          });
          ready.push(tenant.id);
        } catch {
          this.logger.error(`Tenant worker failed: tenant=${snapshot.id}`);
        }
      }
      // One job per tenant per round. A customer with twenty slow probes must
      // not run its entire batch ahead of every other customer's reminders.
      const kinds = [...this.handlers.keys()];
      const configuredConcurrency = Number(process.env.TENANT_JOBS_CONCURRENCY ?? 4);
      const concurrency =
        Number.isSafeInteger(configuredConcurrency) && configuredConcurrency >= 1 && configuredConcurrency <= 16
          ? configuredConcurrency
          : 4;
      let remaining = ready;
      for (let round = 0; round < 20 && remaining.length && kinds.length; round += 1) {
        const next: string[] = [];
        for (let offset = 0; offset < remaining.length; offset += concurrency) {
          const batch = remaining.slice(offset, offset + concurrency);
          const results = await Promise.all(batch.map((id) => this.runOne(id, kinds)));
          batch.forEach((id, index) => {
            if (results[index]) next.push(id);
          });
        }
        remaining = next;
      }
    } catch {
      this.logger.error('Tenant worker cannot resolve active spaces');
    } finally {
      this.running = false;
    }
  }

  private async runOne(tenantId: string, kinds: string[]): Promise<boolean> {
    try {
      const tenant = await this.platform.getTenant(tenantId);
      if (tenant.readOnly) return false;
      return await this.database.run(tenant, async () => {
        const { manager } = this.context.require();
        const jobs = await manager.query<TenantJob[]>(
          `
          SELECT * FROM tenant_jobs WHERE status = 'pending' AND available_at <= now()
          AND kind = ANY($1::text[])
          ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        `,
          [kinds],
        );
        const job = jobs[0];
        if (!job) return false;
        const handler = this.handlers.get(job.kind);
        if (!handler || job.tenant_id !== tenant.id || job.database_shard_id !== tenant.databaseShardId) {
          await manager.query(
            "UPDATE tenant_jobs SET status = 'failed', last_error = 'Invalid tenant context or handler' WHERE id = $1",
            [job.id],
          );
          return true;
        }
        this.context.require().actorId = job.actor_id ?? undefined;
        try {
          // A failed SQL statement rolls back only this handler's writes.
          await runTenantSavepoint(async () => handler(job));
          await manager.query(
            "UPDATE tenant_jobs SET status = 'completed', completed_at = now(), attempts = attempts + 1 WHERE id = $1",
            [job.id],
          );
        } catch {
          await manager.query(
            `UPDATE tenant_jobs SET attempts = attempts + 1,
            status = CASE WHEN attempts >= 9 THEN 'failed' ELSE 'pending' END,
            available_at = now() + interval '1 minute', last_error = 'Handler failed' WHERE id = $1`,
            [job.id],
          );
          this.logger.warn(`Tenant job failed: tenant=${tenant.id}, job=${job.id}, kind=${job.kind}`);
        }
        return true;
      });
    } catch {
      this.logger.error(`Tenant worker failed: tenant=${tenantId}`);
      return false;
    }
  }
}
