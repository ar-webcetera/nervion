import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YandexUserInfo } from './types/yandex-user-info';
import { fetchDirect } from '../common/utils/fetch-direct';

const YANDEX_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token';
const YANDEX_INFO_URL = 'https://login.yandex.ru/info?format=json';

interface YandexTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface YandexInfoResponse {
  id?: string | number;
  default_email?: string;
  emails?: string[];
  real_name?: string;
  display_name?: string;
  login?: string;
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
}

@Injectable()
export class YandexOauthService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    this.ensureConfigured();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'login:email login:info login:avatar',
      state,
      force_confirm: 'yes',
    });
    return `${YANDEX_AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    this.ensureConfigured();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
    });

    const response = await fetchDirect(YANDEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = (await response.json()) as YandexTokenResponse;
    if (!response.ok || !data.access_token) {
      const message = data.error_description || data.error || 'Ошибка обмена кода Яндекса';
      throw new Error(message);
    }

    return data.access_token;
  }

  async fetchUser(accessToken: string): Promise<YandexUserInfo> {
    const response = await fetchDirect(YANDEX_INFO_URL, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const data = (await response.json()) as YandexInfoResponse;
    if (!response.ok) {
      throw new Error('Не удалось получить данные пользователя Яндекса');
    }

    const yandexId = String(data.id ?? '').trim();
    if (!yandexId) {
      throw new Error('Яндекс не вернул идентификатор пользователя');
    }

    let email = (data.default_email || '').trim();
    if (!email && Array.isArray(data.emails) && data.emails.length > 0) {
      email = String(data.emails[0] || '').trim();
    }

    const fullName = (data.real_name || data.display_name || data.login || email || '').trim();
    const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ');

    let photoUrl: string | null = null;
    const avatarId = data.default_avatar_id;
    if (avatarId && !data.is_avatar_empty) {
      photoUrl = `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`;
    }

    return {
      yandexId,
      email,
      firstName: firstName || 'Пользователь',
      lastName: lastName || '',
      photoUrl,
    };
  }

  private get clientId(): string {
    return (this.configService.get<string>('YANDEX_OAUTH_CLIENT_ID') || '').trim();
  }

  private get clientSecret(): string {
    return (this.configService.get<string>('YANDEX_OAUTH_CLIENT_SECRET') || '').trim();
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Вход через Яндекс не настроен');
    }
  }
}
