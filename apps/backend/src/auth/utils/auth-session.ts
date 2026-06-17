import { ConfigService } from '@nestjs/config';

const DEFAULT_AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const MILLISECONDS_IN_SECOND = 1000;

type AuthDurationUnit = 's' | 'm' | 'h' | 'd';

const UNIT_TO_SECONDS: Record<AuthDurationUnit, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
};

const isAuthDurationUnit = (value: string): value is AuthDurationUnit => {
  switch (value) {
    case 's':
    case 'm':
    case 'h':
    case 'd':
      return true;
    default:
      return false;
  }
};

export const getAuthTokenTtlSeconds = (configService: ConfigService): number => {
  const rawExpiresIn = configService.get<string>('JWT_EXPIRES_IN')?.trim();
  if (!rawExpiresIn) {
    return DEFAULT_AUTH_TOKEN_TTL_SECONDS;
  }

  const match = rawExpiresIn.match(/^(\d+)\s*([smhd])?$/i);
  if (!match) {
    return DEFAULT_AUTH_TOKEN_TTL_SECONDS;
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return DEFAULT_AUTH_TOKEN_TTL_SECONDS;
  }

  const unit = match[2]?.toLowerCase() ?? 's';
  if (!isAuthDurationUnit(unit)) {
    return DEFAULT_AUTH_TOKEN_TTL_SECONDS;
  }

  const ttlSeconds = amount * UNIT_TO_SECONDS[unit];
  if (!Number.isSafeInteger(ttlSeconds)) {
    return DEFAULT_AUTH_TOKEN_TTL_SECONDS;
  }

  return ttlSeconds;
};

export const getAuthTokenTtlMs = (configService: ConfigService): number =>
  getAuthTokenTtlSeconds(configService) * MILLISECONDS_IN_SECOND;
