import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';
import type { TenantDescriptor } from '@tracker/contracts';
import { drainTenantWork, TenantContextService, TenantExecutionContext } from './tenant-context.service';
import { getTenantShard, getTenantShards, registerTenantShard } from './tenant-data-source';

interface ShardConfiguration {
  id: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

@Injectable()
export class TenantDatabaseService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TenantDatabaseService.name);
  constructor(private readonly context: TenantContextService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.context.isEnabled()) return;
    const primary = getTenantShard('data_1');
    if (!primary) throw new Error('Primary tenant data source is missing');
    const shards: ShardConfiguration[] = JSON.parse(process.env.DATA_SHARDS_JSON || '[]');
    if (!Array.isArray(shards)) throw new Error('DATA_SHARDS_JSON must be an array');
    for (const shard of shards) {
      if (
        !shard.id ||
        shard.id === 'data_1' ||
        !shard.database ||
        !shard.username ||
        !shard.host ||
        !Number.isInteger(shard.port)
      ) {
        throw new Error('Invalid data shard configuration');
      }
      const options = {
        ...primary.options,
        ...shard,
        type: 'postgres',
        name: shard.id,
        migrationsRun: false,
        synchronize: false,
      } as DataSourceOptions;
      const source = await new DataSource(options).initialize();
      registerTenantShard(shard.id, source);
    }
    for (const [id, source] of getTenantShards()) await this.validateShard(id, source);
  }

  async onApplicationShutdown(): Promise<void> {
    // Nest owns the primary connection. Additional pools belong to this service.
    await Promise.all(
      [...getTenantShards()]
        .filter(([id, source]) => id !== 'data_1' && source.isInitialized)
        .map(([, source]) => source.destroy()),
    );
  }

  private async validateShard(id: string, source: DataSource): Promise<void> {
    const roles = await source.query<Array<{ unsafe: boolean }>>(`
      SELECT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
        OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND pg_has_role(d.datdba, 'MEMBER'))
        OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public' AND pg_has_role(n.nspowner, 'MEMBER'))
        OR has_schema_privilege('public', 'CREATE')
        OR has_database_privilege(current_database(), 'CREATE')) AS unsafe
      FROM pg_roles WHERE rolname = current_user
    `);
    if (roles[0]?.unsafe !== false) throw new Error(`Unsafe database runtime role for ${id}`);
    const tables = await source.query<Array<{ name: string; safe: boolean }>>(`
      SELECT c.relname AS name,
        (c.relrowsecurity AND c.relforcerowsecurity
          AND NOT pg_has_role(c.relowner, 'MEMBER')
          AND NOT has_table_privilege(c.oid, 'TRUNCATE')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
            AND a.attname = 'tenant_id' AND a.attnotnull AND NOT a.attisdropped)) AS safe
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname NOT IN ('migrations', 'tenant_migrations', 'typeorm_metadata', 'app_secrets')
    `);
    if (!tables.length || tables.some((table) => !table.safe))
      throw new Error(`Tenant RLS migration or runtime permissions are incomplete for ${id}`);
    const names = new Set(tables.map((table) => table.name));
    if (source.entityMetadatas.some((metadata) => !names.has(metadata.tableName)))
      throw new Error(`Tenant schema missing tables for ${id}`);
  }

  async run<T>(
    tenant: TenantDescriptor,
    callback: () => Promise<T>,
    options: { readOnly?: boolean; actorId?: number } = {},
  ): Promise<T> {
    if (!this.context.isEnabled()) return callback();
    const current = this.context.current();
    if (current?.active) {
      if (current.tenant.id !== tenant.id || current.tenant.databaseShardId !== tenant.databaseShardId) {
        throw new ServiceUnavailableException('Смена пространства внутри транзакции запрещена');
      }
      return callback();
    }
    const source = getTenantShard(tenant.databaseShardId);
    if (!source) throw new ServiceUnavailableException('База пространства недоступна');
    const runner = source.createQueryRunner();
    const state: TenantExecutionContext = {
      tenant,
      manager: runner.manager,
      actorId: options.actorId,
      active: true,
      afterCommit: [],
      afterRollback: [],
      pending: new Set(),
    };
    let committed = false;
    let result: T;
    try {
      await runner.connect();
      await runner.startTransaction();
      if (options.readOnly || tenant.readOnly) await runner.query('SET TRANSACTION READ ONLY');
      await runner.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('statement_timeout', '60000', true), set_config('idle_in_transaction_session_timeout', '60000', true)",
        [tenant.id],
      );
      result = await this.context.run(state, async () => {
        try {
          return await callback();
        } finally {
          await drainTenantWork(state);
        }
      });
      await runner.commitTransaction();
      committed = true;
    } catch (error) {
      if (!committed) {
        try {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
        } catch {
          this.logger.error('Tenant rollback failed');
        }
        state.active = false;
      }
      throw error;
    } finally {
      state.active = false;
      try {
        await runner.release();
      } catch {
        this.logger.error('Tenant connection release failed');
      }
      // Hooks may open another transaction. Release first, even with pool max=1.
      const hooks = committed ? state.afterCommit : state.afterRollback.slice().reverse();
      for (const hook of hooks) {
        try {
          await hook();
        } catch {
          this.logger.error(`Tenant ${committed ? 'commit' : 'rollback'} hook failed`);
        }
      }
    }
    return result;
  }
}
