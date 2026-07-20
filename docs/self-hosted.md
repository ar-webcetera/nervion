# Развёртывание Нервиона через Docker Compose

Инструкция проверена на чистом локальном развёртывании Linux x86-64 с Docker
29 и Docker Compose 5. Она поднимает PostgreSQL 17, backend и frontend.

## Требования

- Git;
- Docker Engine с плагином Docker Compose;
- свободные порты `3000` и `3026`;
- около 5 ГБ свободного места на первую сборку.

Порт `5432` нужен на хосте только для прямого подключения к PostgreSQL. Backend
работает с БД через внутреннюю сеть Compose.

## 1. Получить исходный код

```bash
git clone https://github.com/ar-webcetera/nervion.git
cd nervion
```

## 2. Подготовить конфигурацию

```bash
cp apps/backend/.env.example apps/backend/.env
```

В `apps/backend/.env` исправьте значение отправителя, чтобы вся строка была в
кавычках:

```dotenv
MAIL_FROM="Tracker <no-reply@example.com>"
```

Задайте данные первого администратора:

```dotenv
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<стойкий-пароль-не-короче-8-символов>
INITIAL_ADMIN_FIRST_NAME=Администратор
INITIAL_ADMIN_LAST_NAME=Нервион
```

Он будет создан автоматически, только если таблица `users` пуста. При следующих
запусках эти переменные не перезаписывают существующего пользователя.

Сгенерируйте VAPID-ключи. Они необходимы для старта backend, даже если
web-push пока не используется:

```bash
docker run --rm node:22-bookworm-slim sh -lc \
  'npm install --silent web-push@3.6.7 && node -e '\''console.log(require("web-push").generateVAPIDKeys())'\'''
```

Перенесите полученные значения в `apps/backend/.env`:

```dotenv
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
```

Не коммитьте `.env`: он содержит секреты и уже добавлен в `.gitignore`.
Остальные необязательные интеграции — S3, почта, OAuth и AI — можно оставить
пустыми для первого локального запуска.

## 3. Подготовить mediasoup-worker

Во время сборки Dockerfile пытается скачать официальный prebuilt с GitHub. Если
соединение с GitHub Releases стабильно, этот шаг можно пропустить.

Если сборка зависает на сообщении `вендорного нет, качаем prebuilt с GitHub`,
скачайте бинарник вручную. Версия должна совпадать с зависимостью `mediasoup` в
`apps/backend/package.json`.

Для версии `3.19.19` на Linux x86-64:

```bash
curl -L --fail -o /tmp/mediasoup-worker.tgz \
  https://github.com/versatica/mediasoup/releases/download/3.19.19/mediasoup-worker-3.19.19-linux-x64-kernel6.tgz
echo 'adf071adf766f306fa73aafe11ff8fbb9e5cf3495426a403fc6f36b043c51285  /tmp/mediasoup-worker.tgz' \
  | sha256sum -c -
tar -xzf /tmp/mediasoup-worker.tgz -C apps/backend/vendor
chmod 755 apps/backend/vendor/mediasoup-worker
```

Бинарник находится в `.gitignore` и не попадёт в репозиторий.

## 4. Собрать образы

```bash
docker compose build
```

Первая сборка продолжительная: backend устанавливает `ffmpeg`, системные
библиотеки и production-зависимости.

## 5. Учесть занятый порт PostgreSQL

При свободном `5432` используйте основной compose-файл. Если порт занят,
добавьте локальный override, отключающий только публикацию БД на хост:

```yaml
# docker-compose.local.yml
services:
  postgres:
    ports: !reset []
```

Далее в командах добавляйте:

```bash
-f docker-compose.yml -f docker-compose.local.yml
```

Например:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres
```

## 6. Запустить и проверить

При первом старте backend штатно применит TypeORM initial migration, создаст
полную схему и затем автоматически заведёт администратора. Отдельная команда
инициализации не нужна. При дальнейших запусках выполняются только новые миграции.

Если база была создана версией Nervion до появления initial migration, сначала
обновите её до схемы версии `0.2.0`. Полностью применённая старая цепочка будет
распознана автоматически; частично обновлённая база намеренно остановит запуск с
понятной ошибкой, чтобы не оставить схему в неопределённом состоянии.

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend frontend postgres
```

Для варианта с занятым `5432`:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

Проверка HTTP:

```bash
curl -I http://127.0.0.1:3000/
curl -I http://127.0.0.1:3026/api/docs
curl -I http://127.0.0.1:3026/api/docs-json
```

Адреса после запуска:

- приложение — <http://localhost:3000>;
- API — <http://localhost:3026>;
- Swagger — <http://localhost:3026/api/docs>;
- OpenAPI JSON — <http://localhost:3026/api/docs-json>.

Редирект `302` с главной страницы frontend на страницу авторизации нормален.
Swagger и OpenAPI должны отвечать кодом `200`.
В Docker Compose Nuxt SSR обращается к backend по `http://backend:3026`, а браузер использует
публичный `NUXT_PUBLIC_API_URL`.

## Обслуживание

Посмотреть логи:

```bash
docker compose logs -f backend frontend
```

Остановить приложение без удаления данных:

```bash
docker compose stop
```

Запустить снова:

```bash
docker compose up -d
```

Обновить код и пересобрать:

```bash
git pull --ff-only
docker compose up -d --build
```

Удаление volume `pg_data` необратимо удаляет локальную БД. Не используйте
`docker compose down -v`, если данные нужны.

## Продакшен

Для публичного сервера дополнительно нужны TLS/reverse proxy, резервное
копирование PostgreSQL и volumes, реальные домены в CORS и auth-настройках,
S3-совместимое хранилище и firewall. Для звонков задайте публичный
`MEDIASOUP_ANNOUNCED_IP` и настройте UDP-порты/ICE. Локальная конфигурация из
этой инструкции не является готовой production-конфигурацией.

### Запуск production-сборки без Docker

Docker не обязателен. На сервере с Node.js 22, pnpm 8 и PostgreSQL приложения
можно собрать и запускать как обычные процессы:

```bash
pnpm install --frozen-lockfile
pnpm --filter backend... build
pnpm --filter frontend... build

node apps/backend/dist/main.js
node apps/frontend/.output/server/index.mjs
```

Backend при старте применяет те же TypeORM-миграции и создаёт первого
администратора независимо от способа запуска. Для Nuxt задайте два адреса API:

```dotenv
NUXT_PUBLIC_API_URL=https://api.example.com
NUXT_API_INTERNAL_URL=http://127.0.0.1:3026
```

Первый используется браузером, второй только серверным рендерингом Nuxt. Если
оба процесса работают на одном сервере, внутренний адрес `127.0.0.1:3026`
подходит без Docker-сети. Процессы следует запускать под systemd или другим
process manager, а наружу публиковать через HTTPS reverse proxy.

Поскольку проект отключает автоматическую компиляцию тяжёлого mediasoup-worker,
при запуске без Docker скачайте подходящий prebuilt по инструкции выше и укажите
его абсолютный путь:

```dotenv
MEDIASOUP_WORKER_BIN=/opt/nervion/apps/backend/vendor/mediasoup-worker
```

Файл должен быть исполняемым (`chmod 755`) и совпадать по версии с зависимостью
`mediasoup` в `apps/backend/package.json`.
