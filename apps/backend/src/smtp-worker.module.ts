import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailboxCoreModule } from './mailbox/mailbox-core.module';
import { DataSource } from 'typeorm';
import { PlatformModule } from './platform/platform.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { tenantDataSource } from './tenancy/tenant-data-source';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST') || 'localhost',
        port: configService.get('POSTGRES_PORT') || 5432,
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        entities: [__dirname + '/**/*.entity{.js,.ts}'],
        synchronize: false,
        migrationsRun: false,
        extra: {
          max: Number(configService.get('SMTP_DB_POOL_MAX')) || 3,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        },
      }),
      dataSourceFactory: async (options) => {
        if (!options) throw new Error('Database configuration is required');
        const source = await new DataSource(options).initialize();
        return process.env.TENANCY_ENABLED === 'true' ? tenantDataSource(source) : source;
      },
    }),
    PlatformModule,
    TenancyModule,
    MailboxCoreModule,
  ],
})
export class SmtpWorkerModule {}
