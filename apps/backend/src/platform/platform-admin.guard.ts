import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PlatformAdminService, PlatformRequest } from './platform-admin.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly admin: PlatformAdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    request.platformAdminEmail = await this.admin.authenticate(request);
    return true;
  }
}
