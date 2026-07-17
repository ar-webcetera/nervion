import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';
import { getAuthTokenTtlMs } from './auth-session';

export const getAuthCookieOptions = (configService: ConfigService, withPersistence = false): CookieOptions => {
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  const options: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: nodeEnv === 'production',
  };

  if (withPersistence) {
    options.maxAge = getAuthTokenTtlMs(configService);
  }

  return options;
};

export const clearAuthCookie = (configService: ConfigService, res: Response, host?: string): void => {
  const secure = (configService.get<string>('NODE_ENV') || 'development') === 'production';
  const base: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure };

  res.clearCookie('authToken', base); // host-only (текущая схема)

  const appDomain = configService.get<string>('APP_DOMAIN');
  if (appDomain) res.clearCookie('authToken', { ...base, domain: appDomain });

  const cleanHost = (host || '').split(':')[0].replace(/\.$/, '');
  if (cleanHost && !/^[0-9.]+$/.test(cleanHost)) {
    const labels = cleanHost.split('.');
    for (let i = 0; i + 2 <= labels.length; i++) {
      res.clearCookie('authToken', { ...base, domain: labels.slice(i).join('.') });
    }
  }
};
