import { Module } from '@nestjs/common';
import { CrmModule } from './crm/crm.module';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TasksModule } from './tasks/tasks.module';
import { TimelogsModule } from './timelogs/timelogs.module';
import { ProjectsModule } from './projects/projects.module';
import { GitModule } from './git/git.module';
import { DeepseekModule } from './deepseek/deepseek.module';
import { UsersModule } from './users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingsModule } from './reportings/reportings.module';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { CommentsModule } from './comments/comments.module';
import { WikiPagesModule } from './wiki-pages/wiki-pages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebsocketModule } from './websocket/websocket.module';
import { ChatsModule } from './chats/chats.module';
import { AllocationsModule } from './allocations/allocations.module';
import { QuickLinksModule } from './quick-links/quick-links.module';
import { ChangelogsModule } from './changelogs/changelogs.module';
import { ApiTokensModule } from './api-tokens/api-tokens.module';
import { HealthchecksModule } from './healthchecks/healthchecks.module';
import { PushModule } from './push/push.module';
import { WorkSchedulesModule } from './work-schedules/work-schedules.module';
import { VoiceModule } from './voice/voice.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { MailboxModule } from './mailbox/mailbox.module';
import { CalendarModule } from './calendar/calendar.module';
import { DataSource } from 'typeorm';
import { TenancyModule } from './tenancy/tenancy.module';
import { PlatformModule } from './platform/platform.module';
import { tenantDataSource } from './tenancy/tenant-data-source';

@Module({
  imports: [
    CrmModule,
    SentryModule.forRoot(),
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
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: configService.get('TENANCY_ENABLED') !== 'true' && configService.get('NODE_ENV') !== 'production',
        extra: {
          max: Number(configService.get('DB_POOL_MAX')) || 5,
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
    TasksModule,
    TimelogsModule,
    ProjectsModule,
    GitModule,
    DeepseekModule,
    UsersModule,
    ReportingsModule,
    AuthModule,
    FilesModule,
    CommentsModule,
    WikiPagesModule,
    AuditLogsModule,
    NotificationsModule,
    WebsocketModule,
    ChatsModule,
    AllocationsModule,
    QuickLinksModule,
    ChangelogsModule,
    ApiTokensModule,
    HealthchecksModule,
    PushModule,
    WorkSchedulesModule,
    VoiceModule,
    MailboxModule,
    CalendarModule,
  ],

  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
