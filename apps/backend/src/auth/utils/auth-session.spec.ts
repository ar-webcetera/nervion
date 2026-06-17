import { ConfigService } from '@nestjs/config';
import { getAuthTokenTtlMs, getAuthTokenTtlSeconds } from './auth-session';

const createConfigService = (expiresIn?: string): ConfigService => new ConfigService({ JWT_EXPIRES_IN: expiresIn });

describe('auth-session utils', () => {
  it('должен использовать 30 дней по умолчанию', () => {
    expect(getAuthTokenTtlSeconds(createConfigService())).toBe(60 * 60 * 24 * 30);
  });

  it('должен разбирать JWT_EXPIRES_IN с суффиксом дней', () => {
    expect(getAuthTokenTtlSeconds(createConfigService('7d'))).toBe(60 * 60 * 24 * 7);
  });

  it('должен разбирать JWT_EXPIRES_IN с суффиксом часов', () => {
    expect(getAuthTokenTtlSeconds(createConfigService('12h'))).toBe(60 * 60 * 12);
  });

  it('должен считать число без суффикса секундами', () => {
    expect(getAuthTokenTtlSeconds(createConfigService('3600'))).toBe(3600);
  });

  it('должен возвращать срок cookie в миллисекундах', () => {
    expect(getAuthTokenTtlMs(createConfigService('2m'))).toBe(60 * 2 * 1000);
  });

  it('должен возвращать 30 дней при некорректном JWT_EXPIRES_IN', () => {
    expect(getAuthTokenTtlSeconds(createConfigService('forever'))).toBe(60 * 60 * 24 * 30);
  });
});
