import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthService } from './jwt.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { ApiTokensModule } from '../api-tokens/api-tokens.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { getAuthTokenTtlSeconds } from './utils/auth-session';
import { JwtSecretService } from './utils/jwt-secret.service';
import { YandexOauthService } from './yandex-oauth.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: '__jwt_default_overridden_per_call__',
        signOptions: { expiresIn: getAuthTokenTtlSeconds(configService) },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Users]),
    ApiTokensModule,
    AuditLogsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthService, JwtSecretService, YandexOauthService, AuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthService, JwtModule, AuthGuard, RolesGuard],
})
export class AuthModule {}
