import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PLATFORM_ENTITIES } from './entities/platform.platform-entity';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformMembershipSyncService } from './platform-membership-sync.service';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [PlatformController],
  providers: [
    {
      provide: getDataSourceToken('platform'),
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<DataSource | null> => {
        if (config.get<string>('TENANCY_ENABLED') !== 'true') return null;
        for (const key of ['PLATFORM_POSTGRES_HOST', 'PLATFORM_POSTGRES_USER', 'PLATFORM_POSTGRES_PASSWORD']) {
          if (!config.get<string>(key)) throw new Error(`${key} is required in tenancy mode`);
        }
        const source = new DataSource({
          name: 'platform',
          type: 'postgres',
          host: config.get<string>('PLATFORM_POSTGRES_HOST'),
          port: Number(config.get<string>('PLATFORM_POSTGRES_PORT') || 6432),
          username: config.get<string>('PLATFORM_POSTGRES_USER'),
          password: config.get<string>('PLATFORM_POSTGRES_PASSWORD'),
          database: config.get<string>('PLATFORM_POSTGRES_DB') || 'nervion_platform',
          entities: PLATFORM_ENTITIES,
          synchronize: false,
          migrationsRun: false,
          extra: { max: 10, application_name: 'nervion-platform' },
        });
        await source.initialize();
        const [role] = await source.query<Array<{ privileged: boolean }>>(
          `SELECT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
            OR EXISTS (SELECT 1 FROM pg_class WHERE relname = 'platform_tenants' AND pg_has_role(relowner, 'MEMBER'))
            OR EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND pg_has_role(datdba, 'MEMBER'))
            OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public' AND pg_has_role(nspowner, 'MEMBER'))
            OR has_schema_privilege('public', 'CREATE')
            OR has_database_privilege(current_database(), 'CREATE')) AS privileged
          FROM pg_roles WHERE rolname = current_user`,
        );
        if (!role || role.privileged) {
          await source.destroy();
          throw new Error('Platform runtime role must not be superuser, table owner or BYPASSRLS');
        }
        await source.query('SELECT 1 FROM platform_tenants LIMIT 1');
        return source;
      },
    },
    PlatformService,
    PlatformAdminService,
    PlatformAdminGuard,
    PlatformMembershipSyncService,
  ],
  exports: [PlatformService, getDataSourceToken('platform')],
})
export class PlatformModule {}
