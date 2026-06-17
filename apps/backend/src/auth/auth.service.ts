import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from '../users/entities/users.entity';
import { JwtAuthService } from './jwt.service';
import { Response } from 'express';
import { LoginEmailDto } from './dto/login-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JwtPayload } from './types/jwt-payload';
import { AuthenticatedUser } from './types/authenticated-user';
import { getAuthCookieOptions, clearAuthCookie } from './utils/auth-cookie-options';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly jwtAuthService: JwtAuthService,
    private readonly auditLogsService: AuditLogsService,
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
}
