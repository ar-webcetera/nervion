import { ConfigService } from '@nestjs/config';
import { YandexOauthService } from './yandex-oauth.service';

jest.mock('../common/utils/fetch-direct', () => ({
  fetchDirect: jest.fn(),
}));

import { fetchDirect } from '../common/utils/fetch-direct';

const fetchDirectMock = fetchDirect as jest.MockedFunction<typeof fetchDirect>;

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
    fetchDirectMock.mockReset();
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
    fetchDirectMock.mockResolvedValue({
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

  it('передает S256 challenge и verifier только для PKCE-входа', async () => {
    const redirectUri = 'https://one.example.test/api/auth/yandex/callback';
    const url = new URL(service.buildAuthorizeUrl('state', redirectUri, 'test-challenge'));
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const legacy = new URL(service.buildAuthorizeUrl('state', redirectUri));
    expect(legacy.searchParams.has('code_challenge')).toBe(false);
    fetchDirectMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ access_token: 'test-token' }) } as Response);
    await expect(service.exchangeCode('code', redirectUri, 'test-verifier')).resolves.toBe('test-token');
    expect(String(fetchDirectMock.mock.calls[0][1]?.body)).toContain('code_verifier=test-verifier');
  });
});
