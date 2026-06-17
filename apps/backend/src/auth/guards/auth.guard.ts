import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditSourceType } from '@tracker/contracts';
import { TokenExpiredError } from 'jsonwebtoken';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../types/jwt-payload';
import { ApiTokensService } from '../../api-tokens/api-tokens.service';
import { AuditContextService } from '../../audit-logs/audit-context.service';
import { AuthenticatedUser } from '../types/authenticated-user';
import { clearAuthCookie } from '../utils/auth-cookie-options';
import { JwtAuthService } from '../jwt.service';
import { Users } from '../../users/entities/users.entity';
import { ConfigService } from '@nestjs/config';

interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  cookies: Record<string, string>;
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthService: JwtAuthService,
    private readonly apiTokensService: ApiTokensService,
    private readonly configService: ConfigService,
    private readonly auditContextService: AuditContextService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const raw = authHeader.slice(7);
      const apiToken = await this.apiTokensService.findByToken(raw);
      if (!apiToken) throw new UnauthorizedException('Неверный или истёкший API-токен');
      const user = await this.findUserOrThrow(apiToken.user_id);
      request.user = user;
      this.auditContextService.setActor(
        {
          id: user.id,
          name: `${user.last_name || ''} ${user.first_name || ''}`.trim() || user.email,
        },
        AuditSourceType.API_TOKEN,
      );
      return true;
    }

    const token = request.cookies.authToken;
    if (!token) {
      throw new UnauthorizedException({
        message: ['Не авторизован'],
      });
    }
    let decoded: JwtPayload;
    try {
      decoded = this.jwtAuthService.verifyToken(token);
    } catch (e) {
      clearAuthCookie(this.configService, response, request.hostname);
      if (e instanceof TokenExpiredError) {
        throw new UnauthorizedException('Срок действия токена истек');
      }
      throw new UnauthorizedException('Неверный токен');
    }
    const payloadUserId = this.extractUserId(decoded);
    if (!payloadUserId) {
      clearAuthCookie(this.configService, response, request.hostname);
      throw new UnauthorizedException('Неверный токен');
    }
    const user = await this.findUserOrThrow(payloadUserId);

    request.user = user;

    this.auditContextService.setActor(
      {
        id: user.id,
        name: `${user.last_name || ''} ${user.first_name || ''}`.trim() || user.email,
      },
      AuditSourceType.WEB,
    );

    return true;
  }

  private extractUserId(decoded: JwtPayload): number | null {
    const candidate = decoded.id ?? decoded.userId;
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) {
      return null;
    }
    return candidate;
  }

  private async findUserOrThrow(userId: number): Promise<AuthenticatedUser> {
    const user = await this.dataSource.getRepository(Users).findOne({
      where: { id: userId },
      select: [
        'id',
        'telegram_user_id',
        'first_name',
        'last_name',
        'patronymic',
        'email',
        'photo_url',
        'role',
        'hidden_menu_items',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return {
      id: user.id,
      telegram_user_id: user.telegram_user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      patronymic: user.patronymic,
      email: user.email,
      photo_url: user.photo_url,
      role: user.role,
      hidden_menu_items: user.hidden_menu_items ?? [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    };
  }
}
