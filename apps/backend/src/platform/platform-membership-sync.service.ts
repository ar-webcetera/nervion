import { Injectable, OnModuleInit } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantJobsService } from '../tenancy/tenant-jobs.service';
import { Users } from '../users/entities/users.entity';
import { PlatformService } from './platform.service';

@Injectable()
export class PlatformMembershipSyncService implements OnModuleInit {
  constructor(
    private readonly jobs: TenantJobsService,
    private readonly context: TenantContextService,
    private readonly platform: PlatformService,
  ) {}

  onModuleInit(): void {
    if (!this.context.isEnabled()) return;
    this.jobs.register('membership-sync', async (job) => {
      const { userId, membershipId } = job.payload;
      if (
        typeof userId !== 'number' ||
        !Number.isSafeInteger(userId) ||
        userId <= 0 ||
        (membershipId !== undefined && typeof membershipId !== 'string')
      )
        throw new Error('Invalid membership sync job');
      const execution = this.context.require();
      const user = await execution.manager.getRepository(Users).findOne({ where: { id: userId }, withDeleted: true });
      await this.platform.synchronizeMembership(execution.tenant.id, userId, user, membershipId);
    });
  }
}
