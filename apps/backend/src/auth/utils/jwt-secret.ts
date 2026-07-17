import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

let cached: string | null = null;

export function setJwtSecret(value: string): void {
  cached = value;
}

export function resolveJwtSecret(configService?: ConfigService): string {
  if (cached) return cached;
  const fromEnv = configService?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET;
  cached = fromEnv && fromEnv.trim() ? fromEnv : randomBytes(48).toString('hex');
  return cached;
}
