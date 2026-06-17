import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiTokensModule } from '../api-tokens/api-tokens.module';
import { Users } from '../users/entities/users.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditContextService } from './audit-context.service';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog } from './entities/audit-log.entity';
import { AuditContextMiddleware } from './middleware/audit-context.middleware';

@Global()
@Module({
  imports: [ApiTokensModule, TypeOrmModule.forFeature([AuditLog, Users])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditContextService, AuditContextMiddleware],
  exports: [AuditLogsService, AuditContextService],
})
export class AuditLogsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
