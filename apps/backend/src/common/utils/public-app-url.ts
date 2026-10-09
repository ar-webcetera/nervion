import { ConfigService } from '@nestjs/config';

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export const getPublicAppOrigin = (config: ConfigService): string => {
  const configuredOrigin = (config.get<string>('APP_PUBLIC_ORIGIN') || config.get<string>('AUTH_PUBLIC_ORIGIN') || '').trim();
  if (configuredOrigin) return trimTrailingSlashes(configuredOrigin);

  const domain = (config.get<string>('APP_DOMAIN') || 'localhost:3000').trim();
  if (/^https?:\/\//i.test(domain)) return trimTrailingSlashes(domain);

  const protocol = /^(localhost|127\.0\.0\.1)(:|$)/i.test(domain) ? 'http' : 'https';
  return `${protocol}://${trimTrailingSlashes(domain)}`;
};

export const buildPublicAppUrl = (config: ConfigService, path: string): string => `${getPublicAppOrigin(config)}${path}`;
