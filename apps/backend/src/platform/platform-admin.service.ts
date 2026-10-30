import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { LessThan } from 'typeorm';
import { PlatformAdminSession, PlatformAudit } from './entities/platform.platform-entity';
import { PlatformService } from './platform.service';
import { verifyIdentityPassword } from './password';
import { resolveTenantHost } from '../tenancy/tenant-host';

export interface PlatformRequest extends Request {
  cookies: Record<string, string | undefined>;
  platformAdminEmail?: string;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly platform: PlatformService,
    private readonly config: ConfigService,
  ) {}

  assertHost(request: Request): void {
    if (!this.platform.isEnabled()) throw new NotFoundException();
    const configured = (this.config.get<string>('PLATFORM_ADMIN_HOST') || 'admin.nervion.ru').toLowerCase();
    const host = resolveTenantHost(request.headers);
    if (host !== configured) throw new NotFoundException();
    const origin = request.get('origin');
    if (origin) {
      const protocol = this.config.get<string>('NODE_ENV') === 'production' ? 'https:' : undefined;
      try {
        const url = new URL(origin);
        if (
          url.hostname.toLowerCase() !== host ||
          (protocol && (url.protocol !== protocol || !!url.port)) ||
          !['http:', 'https:'].includes(url.protocol)
        )
          throw new Error();
      } catch {
        throw new ForbiddenException('Недопустимый источник запроса');
      }
    }
  }

  async login(email: string, password: string, request: Request, response: Response): Promise<{ email: string }> {
    this.assertHost(request);
    const configuredEmail = this.config.get<string>('PLATFORM_ADMIN_EMAIL')?.trim().toLowerCase();
    const configuredHash = this.config.get<string>('PLATFORM_ADMIN_PASSWORD_HASH');
    if (!configuredEmail || !configuredHash?.startsWith('scrypt$'))
      throw new ServiceUnavailableException('Администратор платформы не настроен');
    const normalized = email.trim().toLowerCase();
    const result = await this.platform.database().transaction(async (manager) => {
      // Shared limit across backend replicas; actor is fixed to avoid email-based bypass.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('platform-admin-login', 0))");
      const [{ count }] = await manager.query<Array<{ count: string }>>(
        "SELECT count(*)::text AS count FROM platform_audit WHERE action = 'admin.login.failed' AND created_at > now() - interval '15 minutes'",
      );
      if (Number(count) >= 10) return { limited: true, token: null };
      const valid = verifyIdentityPassword(password, configuredHash);
      if (normalized !== configuredEmail || !valid) {
        await manager
          .getRepository(PlatformAudit)
          .insert({ actor: 'platform-admin', action: 'admin.login.failed', tenantId: null, details: {} });
        return { limited: false, token: null };
      }
      const token = randomBytes(32).toString('base64url');
      await manager.getRepository(PlatformAdminSession).delete({ expiresAt: LessThan(new Date()) });
      await manager
        .getRepository(PlatformAdminSession)
        .insert({ tokenHash: this.hash(token), email: configuredEmail, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) });
      await manager
        .getRepository(PlatformAudit)
        .insert({ actor: configuredEmail, action: 'admin.login', tenantId: null, details: {} });
      return { limited: false, token };
    });
    if (result.limited)
      throw new HttpException('Слишком много попыток входа. Повторите через 15 минут.', HttpStatus.TOO_MANY_REQUESTS);
    if (!result.token) throw new UnauthorizedException('Неверный email или пароль');
    response.cookie(this.cookieName(), result.token, { ...this.cookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
    return { email: configuredEmail };
  }

  async authenticate(request: PlatformRequest): Promise<string> {
    this.assertHost(request);
    const token = request.cookies?.[this.cookieName()];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const session = await this.platform
      .database()
      .getRepository(PlatformAdminSession)
      .findOneBy({ tokenHash: this.hash(token) });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      session.email !== this.config.get<string>('PLATFORM_ADMIN_EMAIL')?.trim().toLowerCase()
    )
      throw new UnauthorizedException();
    return session.email;
  }

  async logout(request: PlatformRequest, response: Response): Promise<void> {
    this.assertHost(request);
    const token = request.cookies?.[this.cookieName()];
    if (token)
      await this.platform
        .database()
        .getRepository(PlatformAdminSession)
        .delete({ tokenHash: this.hash(token) });
    response.clearCookie(this.cookieName(), this.cookieOptions());
  }

  private cookieName(): string {
    return this.config.get<string>('NODE_ENV') === 'production' ? '__Host-platformSession' : 'platformSession';
  }
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict' as const,
      path: '/',
    };
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
