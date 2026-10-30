import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export function normalizeTenantHost(value: string): string {
  if (!value || !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(value)) throw new BadRequestException('Некорректный Host');
  const port = value.match(/:(\d+)$/)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new BadRequestException('Некорректный порт Host');
  const hostname = value.replace(/:\d+$/, '').toLowerCase();
  if (
    hostname.length > 253 ||
    hostname.endsWith('.') ||
    hostname.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  ) {
    throw new BadRequestException('Некорректный Host');
  }
  return hostname;
}

export function resolveTenantHost(headers: IncomingHttpHeaders): string {
  const host = headers['x-nervion-host'];
  const timestamp = headers['x-nervion-timestamp'];
  const signature = headers['x-nervion-signature'];
  if (host !== undefined || timestamp !== undefined || signature !== undefined) {
    const secret = process.env.TENANCY_PROXY_SECRET;
    if (
      !secret ||
      secret.length < 32 ||
      typeof host !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string'
    ) {
      throw new ForbiddenException('Недоверенный прокси');
    }
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature)) {
      throw new ForbiddenException('Недействительная подпись прокси');
    }
    const expected = createHmac('sha256', secret).update(`${timestamp}\n${host}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new ForbiddenException('Недействительная подпись прокси');
    return normalizeTenantHost(host);
  }
  // Forwarded host headers are deliberately ignored. Ingress must preserve Host;
  // server-side Nuxt requests use authenticated headers above.
  if (typeof headers.host !== 'string') throw new BadRequestException('Host не указан');
  return normalizeTenantHost(headers.host);
}
