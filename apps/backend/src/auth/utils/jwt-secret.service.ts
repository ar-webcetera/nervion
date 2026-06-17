import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { setJwtSecret } from './jwt-secret';

// Загружает секрет подписи JWT один раз при старте и кладёт в память.
// По умолчанию секрет хранится в БД (app_secrets) и переживает рестарты.
@Injectable()
export class JwtSecretService implements OnModuleInit {
  private readonly logger = new Logger('JwtSecret');

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const envSecret = this.configService.get<string>('JWT_SECRET');
    if (envSecret && envSecret.trim()) {
      setJwtSecret(envSecret);
      this.logger.log('JWT-секрет взят из переменной окружения (JWT_SECRET).');
      return;
    }
    try {
      const secret = await this.loadOrCreateInDb();
      setJwtSecret(secret);
      this.logger.log('JWT-секрет загружен из БД (переживает рестарты).');
    } catch (e) {
      // Старт не валим: эфемерный секрет на время жизни процесса.
      setJwtSecret(randomBytes(48).toString('hex'));
      this.logger.warn(
        `Не удалось получить JWT-секрет из БД (${(e as Error).message}); ` + 'использую эфемерный (рестарт разлогинит сессии).',
      );
    }
  }

  private async loadOrCreateInDb(): Promise<string> {
    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS app_secrets (
         key text PRIMARY KEY,
         value text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const found = await this.dataSource.query(`SELECT value FROM app_secrets WHERE key = 'jwt_secret' LIMIT 1`);
    if (found.length && found[0].value) return found[0].value as string;

    const generated = randomBytes(48).toString('hex');
    await this.dataSource.query(
      `INSERT INTO app_secrets (key, value) VALUES ('jwt_secret', $1)
       ON CONFLICT (key) DO NOTHING`,
      [generated],
    );
    // на случай гонки нескольких инстансов — перечитать победителя
    const after = await this.dataSource.query(`SELECT value FROM app_secrets WHERE key = 'jwt_secret' LIMIT 1`);
    return (after[0]?.value as string) ?? generated;
  }
}
