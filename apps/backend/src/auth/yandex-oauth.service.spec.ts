import { ConfigService } from '@nestjs/config';
import { YandexOauthService } from './yandex-oauth.service';

describe('YandexOauthService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'YANDEX_OAUTH_CLIENT_ID') return 'client-id';
      if (key === 'YANDEX_OAUTH_CLIENT_SECRET') return 'client-secret';
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new YandexOauthService(config);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('собирает URL авторизации с force_confirm', () => {
    const url = service.buildAuthorizeUrl('state-1', 'https://app.example.ru/api/auth/yandex/callback');
    expect(url).toContain('oauth.yandex.ru/authorize');
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('state=state-1');
    expect(url).toContain('force_confirm=yes');
    expect(url).toContain(encodeURIComponent('https://app.example.ru/api/auth/yandex/callback'));
  });

  it('парсит профиль пользователя Яндекса', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 12345,
          default_email: 'user@yandex.ru',
          real_name: 'Иван Иванов',
          default_avatar_id: 'avatar-1',
          is_avatar_empty: false,
        }),
    } as Response);

    await expect(service.fetchUser('token')).resolves.toEqual({
      yandexId: '12345',
      email: 'user@yandex.ru',
      firstName: 'Иван',
      lastName: 'Иванов',
      photoUrl: 'https://avatars.yandex.net/get-yapic/avatar-1/islands-200',
    });
  });
});
