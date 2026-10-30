# Изолированный препрод

`docker-compose.preprod.yml` запускает серверный тестовый стенд. Это отдельный
Compose project: один frontend, один backend, PostgreSQL с двумя SaaS-базами,
PgBouncer, Redis и приватное S3-compatible хранилище SeaweedFS. Приложения
используют production-сборки. Для локальной разработки сохраняются pnpm dev.

Нельзя объединять этот файл с production Compose или передавать ему рабочие
env, secrets и volumes. Препрод не использует рабочие учетные записи, почтовые
домены и API-ключи. По умолчанию AI, Web Push и почта отключены; Git и мониторинг требуют
явного списка разрешенных хостов. Флаги функций включаются отдельно у клиента.

## Подготовка

1. Скопируйте `deploy/preprod/preprod.env.example` вне репозитория. Задайте
   отдельный project name, тестовый корневой домен, admin hostname и свободные порты.
2. Подготовьте secrets из секции `secrets` Compose. Каталог должен быть закрыт
   для других пользователей хоста. Не переиспользуйте production secrets.
3. Создайте production-образы backend/frontend из одной версии исходников,
   образ PgBouncer и укажите их точные теги или digest в приватном env.
4. Настройте DNS тестовых поддоменов и HTTPS на внешнем reverse proxy.

PostgreSQL и Redis требуют случайных URL-safe паролей длиной от 32 символов.
`git_credential_key` содержит 32 случайных байта в base64. Web Push отключен через
`PUSH_ENABLED=false` и не требует VAPID. Если нужно проверить Push, подготовьте
новую согласованную пару VAPID, подключите ее secrets только backend и явно
включите функцию. Для `platform_admin_password_hash`
используется CLI `hash-admin-password.ts`, пароль вводится через stdin.
`mail_tenants_json` изначально содержит `[]`. TURN secret задается новым случайным
значением, но без `PREPROD_TURN_URLS` TURN не используется.

Файлы secrets должны читаться пользователями контейнеров: PostgreSQL, PgBouncer
и SeaweedFS (UID 1000) работают не под root. Compose bind-mount не меняет владельца файла.
Допустим вариант: закрытый родительский каталог `0700`, файлы secrets `0444`,
каждому сервису монтируется только его список. Не открывайте доступ к самому
каталогу и не выводите `docker compose config` или env с секретами в общие логи.

## Запуск и обновление

Команды выполняются из каталога выбранного релиза. Реальный env хранится отдельно:

```sh
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml config --quiet
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml up -d postgres pgbouncer redis storage
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml --profile deployment run --rm migrate
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml up -d --no-build backend frontend gateway
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml exec -T gateway nginx -t
docker compose --env-file /private/preprod.env -f docker-compose.preprod.yml exec -T gateway nginx -s reload
```

Сначала запускается migration job с отдельными привилегированными учетными
данными. Runtime backend не получает эти secrets. Reload gateway обновляет
адреса контейнеров после их пересоздания. При ошибке миграций приложения
не обновляйте. Перед изменением существующей схемы сделайте проверенный backup.

На пустом стенде `TENANCY_BOOTSTRAP_TENANT_ID` задает стабильный UUID для начальной
миграции. `bootstrap-existing-tenant.js` здесь не запускается: старых пользователей
нет. Через платформенную админку создайте два клиента с отдельными тестовыми
администраторами. Рабочие данные автоматически не копируются.

## Сеть и ограничения

Базы, Redis и S3 не публикуют порты хоста. Gateway по умолчанию слушает только
loopback. `PREPROD_HTTP_BIND_IP` можно заменить адресом закрытого Docker bridge,
если внешний reverse proxy работает в контейнере. Нельзя без firewall выставлять
gateway на публичный интерфейс. Proxy должен сохранять исходный Host и передавать
API, WebSocket и frontend одному gateway. Неподтвержденные служебные заголовки
удаляются; внутренние SSR-запросы подписываются Nuxt.

Redis должен быть отдельным процессом, не другим номером базы production Redis:
Pub/Sub не разделяется по номерам баз. Файлы и Git также хранятся в отдельных
volumes. Секреты хранилища не передаются frontend.

Для голоса дополнительно подключите `deploy/preprod/voice.compose.yml`, задав
свободный диапазон UDP/TCP и публичный IP. Диапазон не должен пересекаться с
другими приложениями. Для корпоративных сетей нужен отдельно настроенный TURN.
Обычный HTTPS reverse proxy не передает медиатрафик. SMTP не запускается до
подготовки отдельного тестового домена, маршрутизации и TLS.

Сервисы имеют лимиты памяти, CPU, процессов и журналов. Начальные runtime-лимиты
суммарно около 2 ГиБ, migration job требует дополнительной памяти во время запуска.
Для S3 задан мягкий предел 8 volumes по 128 МиБ. Это не полный лимит диска:
метаданные и журналы занимают дополнительное место. Контролируйте размеры
volumes, файлов и Git. Сборки выполняйте
вне рабочего сервера. Нагрузочные тесты и принудительные сбои на общем с production
хосте требуют отдельного согласования. Стенд не заменяет HA и PITR production.

## Проверка

Проверьте healthchecks, вход в админку и оба пространства, CRUD и отказ в доступе
с чужим JWT/Host, загрузку и чтение файлов, чат и события между двумя браузерами.
Отдельно проверьте read-only, квоты, флаги модулей и восстановление backup в новую
тестовую базу. Настоящие почта, Git, звонки и мониторинг проверяются по профильным
инструкциям SaaS. Отключенные или не настроенные интеграции не считаются прошедшими
приемку.

Остановка стенда выполняется только с его env и project name. Не используйте
`down -v`: это удалит тестовые базы и файлы. Старый стенд и его volumes сохраняются
до проверки нового; удаление выполняется отдельно по явному запросу.
