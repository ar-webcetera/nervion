import { HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { JwtAuthService } from './jwt.service';
import { Request, Response } from 'express';
import { LoginEmailDto } from './dto/login-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JwtPayload } from './types/jwt-payload';
import { AuthenticatedUser } from './types/authenticated-user';
import { getAuthCookieOptions, clearAuthCookie } from './utils/auth-cookie-options';
import { YandexOauthService } from './yandex-oauth.service';
import { YandexUserInfo } from './types/yandex-user-info';
import {
  YANDEX_OAUTH_STATE_COOKIE,
  getYandexOauthStateCookieOptions,
} from './utils/yandex-oauth-cookies';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly jwtAuthService: JwtAuthService,
    private readonly auditLogsService: AuditLogsService,
    private readonly yandexOauthService: YandexOauthService,
  ) {}

  generateRandomPassword(length = 8) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
  }

  // Легаси-хеш (HMAC-SHA1 на ключе JWT_SECRET) — нужен ТОЛЬКО для проверки старых паролей и их
  // бесшовной миграции на scrypt при первом успешном входе. Когда все мигрируют — можно удалить.
  encryptPassword(password: string): string {
    const APP_SALT = this.configService.get<string>('JWT_SECRET') || '';
    return crypto.createHmac('sha1', APP_SALT).update(password).digest('hex');
  }

  // Параметры scrypt по умолчанию (стоимость). Хранятся прямо в хеше, чтобы их можно было
  // поднять в будущем без поломки старых паролей (каждый хеш проверяется СВОИМИ параметрами).
  private static readonly SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

  // Хеширование пароля: scrypt (KDF, самосолящийся) — не зависит ни от какого app-секрета.
  // Формат: scrypt$N$r$p$<соль>$<хеш>
  hashPassword(password: string): string {
    const { N, r, p, keylen, maxmem } = AuthService.SCRYPT;
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem });
    return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  // Проверка пароля + бесшовная миграция старого HMAC-хеша на scrypt при первом успешном входе
  async verifyPassword(password: string, user: Users): Promise<boolean> {
    const stored = user.hashed_password || '';
    if (stored.startsWith('scrypt$')) {
      const parts = stored.split('$');
      // дефолтные параметры — для совместимости с ранним форматом scrypt$<соль>$<хеш> без параметров
      let N = AuthService.SCRYPT.N;
      let r = AuthService.SCRYPT.r;
      let p = AuthService.SCRYPT.p;
      let saltHex: string;
      let hashHex: string;
      if (parts.length === 6) {
        N = Number(parts[1]);
        r = Number(parts[2]);
        p = Number(parts[3]);
        saltHex = parts[4];
        hashHex = parts[5];
      } else if (parts.length === 3) {
        saltHex = parts[1];
        hashHex = parts[2];
      } else {
        return false;
      }
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      if (!salt.length || !expected.length || !N || !r || !p) return false;
      const derived = crypto.scryptSync(password, salt, expected.length, { N, r, p, maxmem: AuthService.SCRYPT.maxmem });
      return crypto.timingSafeEqual(expected, derived);
    }
    // легаси HMAC-SHA1 → проверяем и сразу пере-хешируем в scrypt
    const legacyOk = !!stored && this.encryptPassword(password) === stored;
    if (legacyOk) {
      const migrated = this.hashPassword(password);
      user.hashed_password = migrated;
      await this.userRepository.update(user.id, { hashed_password: migrated });
    }
    return legacyOk;
  }

  private buildJwtPayload(
    user: Pick<
      Users,
      | 'id'
      | 'email'
      | 'role'
      | 'telegram_user_id'
      | 'first_name'
      | 'last_name'
      | 'patronymic'
      | 'photo_url'
      | 'createdAt'
      | 'updatedAt'
      | 'deletedAt'
    >,
  ): JwtPayload {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      telegram_user_id: user.telegram_user_id ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      patronymic: user.patronymic ?? null,
      photo_url: user.photo_url ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt ?? null,
    };
  }

  async changePassword(changePasswordDto: ChangePasswordDto) {
    const user = await this.userRepository.findOne({ where: { id: changePasswordDto.userId } });
    if (!user) {
      throw new HttpException({ message: ['Пользоваель не найден'] }, HttpStatus.NOT_FOUND);
    }

    const newPassword = this.generateRandomPassword(12);
    user.hashed_password = this.hashPassword(newPassword);

    await this.userRepository.save(user);

    return { newPassword };
  }

  async loginByEmail(loginEmailDto: LoginEmailDto, res: Response, host?: string) {
    const user = await this.userRepository.findOne({
      where: { email: loginEmailDto.email },
      select: [
        'id',
        'telegram_user_id',
        'first_name',
        'last_name',
        'patronymic',
        'email',
        'photo_url',
        'hashed_password',
        'role',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ],
    });
    if (!user) {
      void this.auditLogsService.record({
        actionType: AuditActionType.AUTH_LOGIN_FAILED,
        entityType: AuditEntityType.AUTH,
        summary: 'Неуспешный вход по email: пользователь не найден',
        metadataPayload: {
          email: loginEmailDto.email,
          reason: 'user_not_found',
        },
      });
      throw new HttpException({ message: ['Пользователь не найден'] }, HttpStatus.NOT_FOUND);
    }
    const passwordValid = await this.verifyPassword(loginEmailDto.password, user);

    if (!passwordValid) {
      void this.auditLogsService.record({
        actionType: AuditActionType.AUTH_LOGIN_FAILED,
        entityType: AuditEntityType.AUTH,
        entityId: user.id,
        entityLabel: user.email,
        actor: user,
        summary: 'Неуспешный вход по email: неверный пароль',
        metadataPayload: {
          email: loginEmailDto.email,
          reason: 'wrong_password',
        },
      });
      throw new HttpException({ message: ['Неверный пароль'] }, HttpStatus.UNAUTHORIZED);
    }
    const token = this.jwtAuthService.generateToken(this.buildJwtPayload(user));

    const cookieParams = getAuthCookieOptions(this.configService, true);

    clearAuthCookie(this.configService, res, host);
    res.cookie('authToken', token, cookieParams);

    void this.auditLogsService.record({
      actionType: AuditActionType.AUTH_LOGIN_SUCCESS,
      entityType: AuditEntityType.AUTH,
      entityId: user.id,
      entityLabel: user.email,
      actor: user,
      summary: 'Успешный вход по email',
      afterPayload: {
        method: 'email',
      },
    });
    return res.json(user);
  }

  renewCookie(user: AuthenticatedUser, res: Response) {
    const token = this.jwtAuthService.generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      telegram_user_id: user.telegram_user_id ?? null,
      first_name: user.first_name,
      last_name: user.last_name,
      patronymic: user.patronymic ?? null,
      photo_url: user.photo_url ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt ?? null,
    });
    res.cookie('authToken', token, getAuthCookieOptions(this.configService, true));
  }

  // Демо-вход: без пароля логинит под настроенным демо-пользователем.
  // Включается флагом DEMO_AUTH_ENABLED=true (на проде выключен → 404).
  async demoLogin(res: Response, host?: string) {
    const enabled = (this.configService.get<string>('DEMO_AUTH_ENABLED') || '').toLowerCase() === 'true';
    const email = this.configService.get<string>('DEMO_AUTH_EMAIL');
    if (!enabled || !email) {
      throw new NotFoundException();
    }
    const user = await this.userRepository.findOne({
      where: { email },
      select: [
        'id',
        'telegram_user_id',
        'first_name',
        'last_name',
        'patronymic',
        'email',
        'photo_url',
        'role',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ],
    });
    if (!user) {
      throw new NotFoundException('Демо-пользователь не настроен');
    }
    const token = this.jwtAuthService.generateToken(this.buildJwtPayload(user));
    clearAuthCookie(this.configService, res, host);
    res.cookie('authToken', token, getAuthCookieOptions(this.configService, true));
    return res.redirect('/');
  }

  logout(user: AuthenticatedUser, res: Response, host?: string) {
    clearAuthCookie(this.configService, res, host);
    void this.auditLogsService.record({
      actionType: AuditActionType.AUTH_LOGOUT,
      entityType: AuditEntityType.AUTH,
      entityId: user.id,
      entityLabel: user.email,
      actor: user,
      summary: 'Выход из системы',
    });
    return res.status(HttpStatus.OK).json({ message: 'Вы успешно вышли' });
  }

  startYandexOAuth(res: Response, req: Request) {
    if (!this.yandexOauthService.isConfigured()) {
      throw new ServiceUnavailableException('Вход через Яндекс не настроен');
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const redirectUri = this.buildYandexRedirectUri(req);
    res.cookie(YANDEX_OAUTH_STATE_COOKIE, state, getYandexOauthStateCookieOptions(this.configService));
    return res.redirect(this.yandexOauthService.buildAuthorizeUrl(state, redirectUri));
  }

  async handleYandexCallback(
    req: Request & { cookies: Record<string, string | undefined> },
    res: Response,
    query: Record<string, string | undefined>,
  ) {
    const clearState = () => res.clearCookie(YANDEX_OAUTH_STATE_COOKIE, getYandexOauthStateCookieOptions(this.configService));

    if (query.error) {
      clearState();
      return this.redirectToLogin(res, 'Вход через Яндекс отклонён');
    }

    const code = (query.code || '').trim();
    const state = (query.state || '').trim();
    const savedState = (req.cookies[YANDEX_OAUTH_STATE_COOKIE] || '').trim();
    if (!code || !state || !savedState || state !== savedState) {
      clearState();
      return this.redirectToLogin(res, 'Сессия входа истекла. Попробуйте ещё раз');
    }

    clearState();

    try {
      const redirectUri = this.buildYandexRedirectUri(req);
      const accessToken = await this.yandexOauthService.exchangeCode(code, redirectUri);
      const yandexUser = await this.yandexOauthService.fetchUser(accessToken);
      const user = await this.resolveUserFromYandex(yandexUser);
      this.issueAuthCookie(user, res, req.hostname, 'yandex');
      return res.redirect('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка входа через Яндекс';
      return this.redirectToLogin(res, message);
    }
  }

  private buildYandexRedirectUri(req: Request): string {
    const origin = this.resolvePublicOrigin(req);
    return `${origin}/api/auth/yandex/callback`;
  }

  private resolvePublicOrigin(req: Request): string {
    const configured = (this.configService.get<string>('AUTH_PUBLIC_ORIGIN') || '').trim();
    if (configured) {
      return configured.replace(/\/+$/, '');
    }

    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
    const proto = forwardedProto || req.protocol;
    const host = forwardedHost || req.get('host') || 'localhost';
    return `${proto}://${host}`;
  }

  private redirectToLogin(res: Response, message: string) {
    const params = new URLSearchParams({ oauth_error: message });
    return res.redirect(`/login?${params.toString()}`);
  }

  private async resolveUserFromYandex(info: YandexUserInfo): Promise<Users> {
    const select = [
      'id',
      'telegram_user_id',
      'yandex_id',
      'first_name',
      'last_name',
      'patronymic',
      'email',
      'photo_url',
      'role',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ] as const;

    const byYandex = await this.userRepository.findOne({
      where: { yandex_id: info.yandexId },
      select: [...select],
    });
    if (byYandex) {
      return byYandex;
    }

    if (!info.email) {
      throw new NotFoundException('У аккаунта Яндекса нет email. Обратитесь к администратору');
    }

    const byEmail = await this.userRepository.findOne({
      where: { email: info.email },
      select: [...select, 'hashed_password'],
    });
    if (!byEmail) {
      throw new NotFoundException('Аккаунт не найден. Попросите администратора создать пользователя с вашим email');
    }

    const taken = await this.userRepository.findOne({
      where: { yandex_id: info.yandexId },
      select: ['id'],
    });
    if (taken && taken.id !== byEmail.id) {
      throw new HttpException({ message: ['Этот Яндекс ID уже привязан к другому пользователю'] }, HttpStatus.CONFLICT);
    }

    await this.userRepository.update(byEmail.id, {
      yandex_id: info.yandexId,
      photo_url: byEmail.photo_url || info.photoUrl || undefined,
      first_name: byEmail.first_name === 'Имя' && info.firstName ? info.firstName : byEmail.first_name,
      last_name: byEmail.last_name === 'Фамилия' && info.lastName ? info.lastName : byEmail.last_name,
    });

    const linked = await this.userRepository.findOne({
      where: { id: byEmail.id },
      select: [...select],
    });
    if (!linked) {
      throw new NotFoundException('Пользователь не найден');
    }
    return linked;
  }

  private issueAuthCookie(user: Users, res: Response, host: string | undefined, method: 'email' | 'yandex' | 'demo') {
    const token = this.jwtAuthService.generateToken(this.buildJwtPayload(user));
    clearAuthCookie(this.configService, res, host);
    res.cookie('authToken', token, getAuthCookieOptions(this.configService, true));

    void this.auditLogsService.record({
      actionType: AuditActionType.AUTH_LOGIN_SUCCESS,
      entityType: AuditEntityType.AUTH,
      entityId: user.id,
      entityLabel: user.email,
      actor: user,
      summary: method === 'yandex' ? 'Успешный вход через Яндекс' : 'Успешный вход по email',
      afterPayload: { method },
    });
  }
}
