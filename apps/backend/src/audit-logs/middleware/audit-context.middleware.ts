import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuditSourceType } from '@tracker/contracts';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AuditContextService } from '../audit-context.service';

@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(private readonly auditContextService: AuditContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const requestId = String(req.headers['x-request-id'] || randomUUID());
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim() || req.ip || null
        : req.ip || null;

    res.setHeader('x-request-id', requestId);

    this.auditContextService.run(
      {
        requestId,
        ipAddress,
        userAgent: req.get('user-agent') || null,
        requestMethod: req.method,
        requestPath: req.originalUrl || req.url,
        sourceType: AuditSourceType.WEB,
        actor: null,
      },
      next,
    );
  }
}
