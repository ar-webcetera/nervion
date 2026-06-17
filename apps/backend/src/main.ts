// Инициализация Sentry/GlitchTip ДО любого другого импорта (нужно для авто-инструментирования).
import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { buildProxyUrlFromEnv, DEFAULT_NO_PROXY } from './common/utils/proxy-url';

const REQUEST_BODY_LIMIT = '1mb';
// Опционально: разрешить CORS для всех https-поддоменов корневого хоста.
// Задаётся через env CORS_ALLOWED_ROOT_HOST (например, example.com). Пусто = выключено.
const CORS_ALLOWED_ROOT_HOST = (process.env.CORS_ALLOWED_ROOT_HOST || '').trim().toLowerCase();

function isAllowedRootHostOrigin(origin: string): boolean {
  if (!CORS_ALLOWED_ROOT_HOST) {
    return false;
  }
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === 'https:' &&
      !url.port &&
      (hostname === CORS_ALLOWED_ROOT_HOST || hostname.endsWith(`.${CORS_ALLOWED_ROOT_HOST}`))
    );
  } catch {
    return false;
  }
}

export function buildProxyUrl(): string | null {
  return buildProxyUrlFromEnv();
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const configService = new ConfigService();
  // Разрешённые origin'ы задаются через env CORS_ALLOWED_ORIGINS (через запятую).
  const allowedOrigins = new Set(
    (configService.get<string>('CORS_ALLOWED_ORIGINS') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const tauriOriginPattern = /^(tauri|https):\/\/(tauri\.localhost|localhost)(:\d+)?$/;
  const PROXY_ENABLE = configService.get<number>('PROXY_ENABLE');
  const NO_PROXY = configService.get<string>('NO_PROXY');
  if (Number(PROXY_ENABLE)) {
    const proxyUrl = buildProxyUrl();
    if (proxyUrl) {
      process.env.NO_PROXY = NO_PROXY || DEFAULT_NO_PROXY;
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }
  }
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: REQUEST_BODY_LIMIT });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  const config = new DocumentBuilder()
    .setTitle('API Нервион')
    .setVersion('1.0.0')
    .addCookieAuth('authToken', {
      type: 'apiKey',
      in: 'cookie',
      name: 'authToken',
      description: 'JWT токен в cookie authToken',
    })
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Token',
        description: 'API-токен вида wct_... (для внешних приложений)',
      },
      'api-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (
        !origin ||
        localhostOriginPattern.test(origin) ||
        tauriOriginPattern.test(origin) ||
        allowedOrigins.has(origin) ||
        isAllowedRootHostOrigin(origin)
      ) {
        callback(null, true);
        return;
      }

      // Не кидаем Error — иначе ошибка пробрасывается дальше и превращается в 500.
      // Просто отказываем без CORS-заголовков: cross-origin браузер сам заблокирует,
      // а нативные клиенты (Tauri http, curl) получат корректный ответ.
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Allow-Origin', 'Range'],
    exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'ETag'],
    credentials: true,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`${req.method} ${req.originalUrl}`);
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
        exposeUnsetFields: false,
      },
      skipNullProperties: false,
      skipUndefinedProperties: false,
    }),
  );
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Приложение запущено на порту: ${process.env.PORT}`);
}
void bootstrap();
