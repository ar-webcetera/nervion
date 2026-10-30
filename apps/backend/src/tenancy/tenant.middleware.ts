import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { normalizeTenantHost, resolveTenantHost } from './tenant-host';

class RollbackHttpResponse extends Error {}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly context: TenantContextService,
    private readonly database: TenantDatabaseService,
    private readonly platform: PlatformService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.context.isEnabled()) {
      next();
      return;
    }
    const hostname = resolveTenantHost(req.headers);
    // Express matches static routes case-insensitively; policy matching must do the same.
    const path = req.originalUrl.split('?')[0].toLowerCase();
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Host');
    if (/^\/api\/platform(?:\/|$)/.test(path)) {
      if (hostname !== normalizeTenantHost(process.env.PLATFORM_ADMIN_HOST || 'admin.nervion.ru')) throw new NotFoundException();
      next();
      return;
    }
    // The webhook controller authenticates its per-tenant secret before opening
    // a data transaction. Never accept this machine endpoint on a tenant host.
    if (/^\/api\/mailbox\/postbox-events(?:\/|$)/.test(path)) {
      if (
        req.method !== 'POST' ||
        req.headers.origin ||
        hostname !== normalizeTenantHost(process.env.PLATFORM_ADMIN_HOST || 'admin.nervion.ru') ||
        !/^\/api\/mailbox\/postbox-events\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/.test(path)
      )
        throw new NotFoundException();
      next();
      return;
    }
    const tenant = await this.platform.resolveTenant(hostname);
    if (req.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        throw new ForbiddenException('Некорректный Origin');
      }
      if (
        origin.hostname !== hostname ||
        !['http:', 'https:'].includes(origin.protocol) ||
        (process.env.NODE_ENV === 'production' && (origin.protocol !== 'https:' || !!origin.port))
      ) {
        throw new ForbiddenException('Запрос с другого пространства запрещен');
      }
    }
    const features: Record<string, string> = {
      tasks: 'tasks',
      comments: 'tasks',
      timelogs: 'tasks',
      calendar: 'tasks',
      projects: 'projects',
      allocations: 'projects',
      files: 'files',
      chats: 'chat',
      'wiki-pages': 'wiki',
      crm: 'crm',
      reportings: 'reports',
      git: 'git',
      repos: 'git',
      mailbox: 'mail',
      'mail-accounts': 'mail',
      'mail-messages': 'mail',
      'mail-folders': 'mail',
      postbox: 'mail',
      voice: 'voice',
      healthchecks: 'healthchecks',
    };
    const feature = features[path.split('/')[2]];
    const optIn = ['mail', 'git', 'voice', 'healthchecks'];
    if (feature && (optIn.includes(feature) ? tenant.featureFlags[feature] !== true : tenant.featureFlags[feature] === false)) {
      throw new ForbiddenException('Функция отключена для пространства');
    }
    const authentication = /^\/api\/auth\/(?:login\/email|logout|me)$/.test(path);
    if (tenant.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !authentication) {
      throw new ForbiddenException('Пространство доступно только для чтения');
    }
    const originalEnd: Response['end'] = res.end.bind(res);
    let endArguments: Parameters<Response['end']> | undefined;
    let resolveResponse: (() => void) | undefined;
    let rejectResponse: ((error: Error) => void) | undefined;
    const closed = () => rejectResponse?.(new RollbackHttpResponse('Request closed'));
    res.end = ((...args: Parameters<Response['end']>) => {
      if (endArguments) return res;
      endArguments = args;
      if (res.statusCode >= 400) rejectResponse?.(new RollbackHttpResponse());
      else resolveResponse?.();
      return res;
    }) as Response['end'];
    res.once('close', closed);
    try {
      await this.database.run(
        tenant,
        () =>
          new Promise<void>((resolve, reject) => {
            resolveResponse = resolve;
            rejectResponse = reject;
            next();
          }),
      );
    } catch (error) {
      if (!(error instanceof RollbackHttpResponse)) {
        res.end = originalEnd;
        res.removeListener('close', closed);
        if (res.headersSent) res.destroy();
        else next(error);
        return;
      }
    }
    res.end = originalEnd;
    res.removeListener('close', closed);
    if (endArguments && !res.destroyed) originalEnd.apply(res, endArguments);
  }
}
