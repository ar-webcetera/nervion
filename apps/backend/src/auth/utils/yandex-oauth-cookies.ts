import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';

export const YANDEX_OAUTH_STATE_COOKIE = 'yandexOauthState';
export const YANDEX_OAUTH_LINK_COOKIE = 'yandexOauthLink';

export const getYandexOauthStateCookieOptions = (configService: ConfigService): CookieOptions => {
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: nodeEnv === 'production',
    maxAge: 10 * 60 * 1000,
  };
};
