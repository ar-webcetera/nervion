import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantJobsService } from './tenant-jobs.service';
import { TenantController } from './tenant.controller';

@Global()
@Module({
  controllers: [TenantController],
  providers: [TenantContextService, TenantDatabaseService, TenantMiddleware, TenantJobsService],
  exports: [TenantContextService, TenantDatabaseService, TenantJobsService],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
