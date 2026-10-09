import { ConfigService } from '@nestjs/config';
import { buildPublicAppUrl, getPublicAppOrigin } from './public-app-url';

describe('public app URL', () => {
  it('использует явно заданный публичный origin приложения', () => {
    const config = new ConfigService({
      APP_PUBLIC_ORIGIN: 'https://app.nervion.ru/',
      APP_DOMAIN: 'tracker.webcetera.ru',
    });

    expect(getPublicAppOrigin(config)).toBe('https://app.nervion.ru');
    expect(buildPublicAppUrl(config, '?task-id=12&comment-id=5')).toBe('https://app.nervion.ru?task-id=12&comment-id=5');
  });

  it('не добавляет устаревший префикс к APP_DOMAIN', () => {
    const config = new ConfigService({ APP_DOMAIN: 'app.example.com' });

    expect(buildPublicAppUrl(config, '/crm/deals?deal=41')).toBe('https://app.example.com/crm/deals?deal=41');
  });

  it('использует http для локальной разработки', () => {
    const config = new ConfigService({ APP_DOMAIN: 'localhost:3026' });

    expect(getPublicAppOrigin(config)).toBe('http://localhost:3026');
  });
});
