import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

// Единый источник секрета подписи JWT. Конкретный источник выбирается при старте
// (JwtSecretService.onModuleInit):
//   1) JWT_SECRET из окружения, если ЯВНО задан — необязательный override;
//   2) иначе секрет хранится в БД (таблица app_secrets): генерируется при первом
//      старте и переживает рестарты/редеплои. Руками ничего хранить/бэкапить не
//      нужно, отдельно терять нечего — есть база, есть секрет.
// resolveJwtSecret() синхронный (зовётся на каждый запрос из jwt.service) и просто
// отдаёт уже загруженное в память значение.
let cached: string | null = null;

export function setJwtSecret(value: string): void {
  cached = value;
}

export function resolveJwtSecret(configService?: ConfigService): string {
  if (cached) return cached;
  // Подстраховка, если секрет почему-то не успели загрузить при старте:
  const fromEnv = configService?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET;
  cached = fromEnv && fromEnv.trim() ? fromEnv : randomBytes(48).toString('hex');
  return cached;
}
