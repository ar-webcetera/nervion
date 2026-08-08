# Разработка

Монорепо на pnpm + turbo. Приложения:

- `apps/backend` — API (NestJS + TypeORM, PostgreSQL).
- `apps/frontend` — основное приложение (Nuxt 3 / Vue).
- `packages/contracts` — общие типы/контракты между backend и frontend.

## Быстрый старт через Docker

Полный комплект (PostgreSQL + backend + frontend) одной командой:

```bash
cp apps/backend/.env.example apps/backend/.env   # заполнить JWT_SECRET
docker compose up --build
```

Фронтенд — http://localhost:3000, API — http://localhost:3026. Миграции накатываются автоматически. Конфигурация compose — в `docker-compose.yml` (корень). Голосовые комнаты (WebRTC) требуют доп. настройки, см. ниже.

## Установка для локальной разработки (без Docker)

```bash
pnpm i
```

Скопируйте примеры конфигурации и заполните значения:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Описание всех переменных — в этих `.env.example` (секреты помечены `[secret]`).

## Запуск в dev

```bash
pnpm --filter backend dev
pnpm --filter frontend dev
# либо через turbo
pnpm turbo run dev --filter=backend
pnpm turbo run dev --filter=frontend
```

## Сборка

```bash
pnpm run build
# или точечно
pnpm turbo run build --filter=backend
pnpm turbo run build --filter=frontend
```

После сборки в `apps/<service>` появится каталог `.output`/`dist`.

## База данных и миграции

Схема управляется миграциями TypeORM.

```bash
cd apps/backend
pnpm migration:generate src/migrations/<NAME>   # сгенерировать по изменению entity
pnpm migration:run                              # применить
pnpm migration:revert                           # откатить последнюю
```

В проде миграции применяются автоматически при старте бэкенда (`migrationsRun`).

## Аутентификация

Web-авторизация хранится в httpOnly-cookie. Срок жизни JWT и cookie берётся из `JWT_EXPIRES_IN` (секунды или суффиксы `s`/`m`/`h`/`d`); по умолчанию `30d`.

## Почта (модуль mailbox)

Входящая почта принимается отдельным SMTP-процессом Nest (порт из `SMTP_PORT`), исходящая — через SES-совместимый Postbox. HTTP API работает в основном backend-процессе. После сохранения нового входящего письма SMTP-процесс отправляет web-push всем пользователям с доступом к ящику; нажатие открывает соответствующий тред. Конфигурация — переменные `MAILBOX_*`, `POSTBOX_*` и `VAPID_*` (см. `apps/backend/.env.example`). Почтовые аккаунты создаются после первой миграции через `POST /api/mailbox/accounts`.

### Трекинг доставки исходящих

На исходящих письмах хранятся `provider_message_id`, `delivery_status`, счётчики открытий/кликов. События Postbox (`Delivery`, `Bounce`, `Complaint`, `Open`, `Click`) принимаются на `POST /api/mailbox/postbox-events` с заголовком `Authorization: Bearer <POSTBOX_EVENTS_WEBHOOK_SECRET>`.

Чтобы события пошли:

1. В Postbox создайте configuration set, включите Engagement statistics и подписку на нужные типы событий в Data Streams.
2. Укажите имя set в `POSTBOX_CONFIGURATION_SET`.
3. Из Data Streams прокидывайте JSON на webhook: Cloud Function из `deploy/yandex-cloud/postbox-webhook/` (триггер Data Streams → функция → `POST /api/mailbox/postbox-events`). Тело: одно событие Postbox, `{ "events": [...] }`, `{ "messages": [...] }` (формат триггера CF) или Kinesis `{ "Records": [{ "kinesis": { "data": "<base64>" } }] }`.

Статистика по доступным ящикам: `GET /api/mailbox/stats?account_id=&from=&to=`. В UI почты — папка «Статистика» и бейджи статусов в «Отправленных».


## WebRTC (звонки/голосовые комнаты)

Используется mediasoup. Для работы вне localhost задайте публичный IP сервера в `MEDIASOUP_ANNOUNCED_IP` и при необходимости ICE-серверы в `MEDIASOUP_ICE_SERVERS`.

## Деплой

Деплой — через push ветки: CI/CD сам собирает и доставляет изменения. Вручную prod/preprod-процессы не перезапускаются без явного запроса (см. `AGENTS.md`).
