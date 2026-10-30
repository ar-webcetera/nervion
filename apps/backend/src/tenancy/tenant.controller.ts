import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import type { TenantDescriptor } from '@tracker/contracts';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantContextService } from './tenant-context.service';

@Controller('tenant')
@UseGuards(AuthGuard)
export class TenantController {
  constructor(private readonly context: TenantContextService) {}

  @Get('context')
  getContext(): TenantDescriptor {
    if (!this.context.isEnabled()) throw new NotFoundException();
    return this.context.require().tenant;
  }
}
