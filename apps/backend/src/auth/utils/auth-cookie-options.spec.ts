import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { clearAuthCookie } from './auth-cookie-options';

describe('clearAuthCookie', () => {
  it('не передаёт localhost с портом как cookie domain', () => {
    const clearCookie = jest.fn();
    const configService = new ConfigService({ APP_DOMAIN: 'localhost:3026', NODE_ENV: 'development' });

    clearAuthCookie(configService, { clearCookie } as Pick<Response, 'clearCookie'> as Response, 'localhost');

    expect(clearCookie).toHaveBeenCalledTimes(1);
    expect(clearCookie).toHaveBeenCalledWith('authToken', expect.not.objectContaining({ domain: expect.anything() }));
  });

  it('очищает cookie для домена без схемы, порта и пути', () => {
    const clearCookie = jest.fn();
    const configService = new ConfigService({
      APP_DOMAIN: 'https://app.example.com:3026/path',
      NODE_ENV: 'production',
    });

    clearAuthCookie(configService, { clearCookie } as Pick<Response, 'clearCookie'> as Response);

    expect(clearCookie).toHaveBeenCalledWith('authToken', expect.objectContaining({ domain: 'app.example.com', secure: true }));
  });
});
