import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ROLES } from '../../common/enums/roles.enum';
import { AuthenticatedUser } from '../types/authenticated-user';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<ROLES[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user) {
      throw new ForbiddenException('Доступ запрещён: пользователь не определён');
    }
    const hasRole = requiredRoles.some((role) => user.role === role);
    if (!hasRole) throw new ForbiddenException('Доступ запрещён: недостаточно прав');
    return hasRole;
  }
}
