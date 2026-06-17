import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailboxCoreModule } from './mailbox/mailbox-core.module';

// Урезанный модуль для SMTP-воркера: только БД, S3 и mailbox.
// Миграции гоняет основной бэкенд (migrationsRun там), воркер — нет.
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
        // Маленький пул: воркер обрабатывает почту нечасто, незачем держать много соединений
        extra: {
          max: Number(configService.get('SMTP_DB_POOL_MAX')) || 3,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        },
      }),
    }),
    MailboxCoreModule,
  ],
})
export class SmtpWorkerModule {}
