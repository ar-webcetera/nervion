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

  // Host-only cookie: НЕ задаём Domain. Фронт и API на одном origin, домен не нужен.
  // С Domain=APP_DOMAIN кука отвергалась браузером на другом хосте (напр. preprod.app.nervion.ru) — и не было входа.
  return options;
};

// Чистит куку authToken во ВСЕХ возможных scope: host-only, APP_DOMAIN (легаси) и
// все родительские домены текущего host. Старые куки, выставленные когда-то с
// Domain=..., host-only-чисткой не удаляются и «затеняют» новую host-only куку,
// ломая вход — поэтому чистим по всем вариантам (несуществующие безвредны).
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
