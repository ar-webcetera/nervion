# Разработка

Монорепо на pnpm + turbo. Приложения:

- `apps/backend` — API (NestJS + TypeORM, PostgreSQL).
- `apps/frontend` — основное приложение (Nuxt 3 / Vue).
- `packages/contracts` — общие типы/контракты между backend и frontend.

## Быстрый старт через Docker

Для запуска PostgreSQL, API и веб-приложения используйте
[инструкцию по Docker Compose](./self-hosted.md). В ней описаны настройка первого
администратора и генерация VAPID-ключей.

## Установка для локальной разработки (без Docker)

Установите Node.js 22 и pnpm 8.15.6. Из корня репозитория установите зависимости:

```bash
pnpm install --frozen-lockfile
```

Скопируйте примеры конфигурации:

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Запустите PostgreSQL и укажите параметры подключения в `apps/backend/.env`.
Там же задайте данные первого администратора и VAPID-ключи. Для локального запуска
подготовьте [mediasoup-worker](./self-hosted.md#3-подготовить-mediasoup-worker)
и укажите абсолютный путь к нему в `MEDIASOUP_WORKER_BIN`.

## Запуск в dev

Из корня репозитория запустите оба приложения:

```bash
pnpm dev:main
```

Веб-приложение доступно на <http://localhost:3000>, Swagger на
<http://localhost:3026/api/docs>.

## Сборка

```bash
pnpm run build
# или точечно
pnpm turbo run build --filter=backend
pnpm turbo run build --filter=frontend
```

После сборки в `apps/<service>` появится каталог `.output`/`dist`.

Dockerfile используют BuildKit-кэш для pnpm и Vite. При изменении только
исходников повторная сборка переиспользует установленные production-зависимости.
Холодная сборка после изменения lockfile остаётся дольше, потому что кэш нужно
создать заново.

Команда `pnpm verify:push` запускает линтер, проверку типов и тесты backend,
затем сборку backend и frontend. Отдельная проверка типов frontend запускается
командой `pnpm typecheck:frontend`.

## База данных и миграции

Схема управляется миграциями TypeORM.

```bash
cd apps/backend
pnpm typeorm migration:generate src/migrations/add-example-field
pnpm migration:run                              # применить
pnpm migration:revert                           # откатить последнюю
```

В проде миграции применяются автоматически при старте бэкенда (`migrationsRun`).

## Аутентификация

Web-авторизация хранится в httpOnly-cookie. Срок жизни JWT и cookie берётся из `JWT_EXPIRES_IN` (секунды или суффиксы `s`/`m`/`h`/`d`); по умолчанию `30d`.

## Push-уведомления на Android

Откройте приложение по HTTPS, войдите в аккаунт и нажмите "Разрешить" в баннере.
Сообщение "Уведомления включены" появляется после сохранения подписки на сервере.
Управлять подпиской и отправить тестовое уведомление можно в настройках профиля.

Если подписка есть, а уведомления не приходят, проверьте разрешения браузера и
Android, ошибки `Push failed` в логах backend и доступность push-сервиса.
При настроенном `NUXT_PUBLIC_SENTRY_DSN` события подключения, отключения и
тестовой отправки доступны в GlitchTip с тегом `feature:web_push`.
Тег `push_stage` показывает этап сбоя.

Проверки подписок запускаются из корня репозитория на Node.js 22.6+.

```bash
node --experimental-strip-types --test apps/frontend/tests/push-subscription.test.mjs
node apps/frontend/tests/push-store.test.mjs
```

## Почта (модуль mailbox)

Входящая почта принимается отдельным SMTP-процессом Nest (порт из `SMTP_PORT`), исходящая отправляется через SES-совместимый Postbox. HTTP API работает в основном backend-процессе. Системные письма календаря, задач и уведомлений отправляются от ящика `MAILBOX_NOTIFICATION_ACCOUNT`, обычно `bot@<домен>`. После сохранения нового входящего письма SMTP-процесс отправляет web-push владельцу ящика; нажатие открывает соответствующий тред. Конфигурация задаётся переменными `MAILBOX_*`, `POSTBOX_*` и `VAPID_*` (см. `apps/backend/.env.example`). Почтовые аккаунты создаются после первой миграции через `POST /api/mailbox/accounts`.

### Трекинг доставки исходящих

На исходящих письмах хранятся `provider_message_id`, `delivery_status`, счётчики открытий/кликов. События Postbox (`Delivery`, `Bounce`, `Complaint`, `Open`, `Click`) принимаются на `POST /api/mailbox/postbox-events` с заголовком `Authorization: Bearer <POSTBOX_EVENTS_WEBHOOK_SECRET>`.

Чтобы события пошли:

1. В Postbox создайте configuration set, включите Engagement statistics и подписку на нужные типы событий в Data Streams.
2. Укажите имя set в `POSTBOX_CONFIGURATION_SET`.
3. Из Data Streams прокидывайте JSON на webhook: Cloud Function из `deploy/yandex-cloud/postbox-webhook/` (триггер Data Streams → функция → `POST /api/mailbox/postbox-events`). Тело: одно событие Postbox, `{ "events": [...] }`, `{ "messages": [...] }` (формат триггера CF) или Kinesis `{ "Records": [{ "kinesis": { "data": "<base64>" } }] }`.

Статистика по доступным ящикам: `GET /api/mailbox/stats?account_id=&from=&to=`. В UI почты — папка «Статистика» и бейджи статусов в «Отправленных».

### Контроль доставки

При заданных `SENTRY_DSN` и `POSTBOX_CONFIGURATION_SET` backend каждые пять минут
проверяет письма, отправленные через Postbox за последние сутки. Если письмо
старше 15 минут и по нему нет событий, backend отправляет
`mail-delivery-events-missing`. Ошибка самой проверки отмечается событием
`mail-delivery-monitor-failed`. Для доставки этих оповещений настройте правила
в GlitchTip или Sentry.

## WebRTC (звонки/голосовые комнаты)

Используется mediasoup. Для работы вне localhost задайте публичный IP сервера в `MEDIASOUP_ANNOUNCED_IP` и при необходимости ICE-серверы в `MEDIASOUP_ICE_SERVERS`.

## Деплой

[Запуск на своём сервере и требования к production](./self-hosted.md#продакшен).
