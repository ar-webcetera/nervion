# Production SaaS на одном хосте

Это отдельный контур с одним целевым PostgreSQL primary, а не резервный сервер.
В нем две логические БД: `nervion_platform` и `nervion_data_1`. Backend, frontend,
SMTP, Redis и PgBouncer общие для клиентов. Старый общий PostgreSQL, другие
приложения и внешний TLS proxy не входят в этот Compose project.

Один хост остается точкой отказа. Зашифрованный S3 backup позволяет восстановить
данные, но не обеспечивает HA или непрерывную работу при отказе VDS.

## Что нужно подготовить

Используйте отдельный project name, внешние private env/secrets и готовые
неизменяемые образы. `compose.yml` не собирает образы. Все image references
должны быть digest или точным `sha256:` image ID. Backend, SMTP и migrate используют
один образ; frontend собран из того же commit. Для app-образов нужен OCI label
`org.opencontainers.image.revision`. Инфраструктурные образы имеют свои версии.
Сборка PostgreSQL описана в [postgres](./postgres/README.md).

Обязательные переменные private env:

| Переменные | Назначение |
| --- | --- |
| `PRODUCTION_PROJECT_NAME` | Новый изолированный Compose project |
| `PRODUCTION_DEPLOYMENT_PHASE` | `precutover` или `live`, без значения по умолчанию |
| `PRODUCTION_BACKEND_IMAGE`, `PRODUCTION_FRONTEND_IMAGE` | Готовые app-образы |
| `PRODUCTION_POSTGRES_IMAGE`, `PRODUCTION_PGBOUNCER_IMAGE`, `PRODUCTION_REDIS_IMAGE`, `PRODUCTION_GATEWAY_IMAGE` | Проверенные инфраструктурные образы |
| `PRODUCTION_BACKEND_PORT`, `PRODUCTION_FRONTEND_PORT`, `PRODUCTION_HTTP_PORT`, `PRODUCTION_PGBOUNCER_PORT`, `PRODUCTION_REDIS_PORT` | Разные проверенные свободные порты не меньше 1024; все, кроме private ingress, на loopback |
| `PRODUCTION_INGRESS_BIND_IP` | `127.0.0.1` или проверенный RFC1918 IPv4 интерфейс хоста, доступный внешнему TLS proxy; не wildcard/public IP |
| `PRODUCTION_ROOT_DOMAIN`, `PRODUCTION_ADMIN_HOST`, `PRODUCTION_ADMIN_EMAIL` | Домен клиентов и администратор платформы |
| `PRODUCTION_BOOTSTRAP_TENANT_ID` | Неизменный UUID первого пространства |
| `PRODUCTION_TENANT_JOBS_ENABLED` | `false` до cutover, затем явно `true` |
| `PRODUCTION_STORAGE_ENDPOINT`, `PRODUCTION_STORAGE_REGION`, `PRODUCTION_STORAGE_BUCKET` | Внешнее application S3, endpoint только HTTPS |
| `PRODUCTION_EXTERNAL_GIT_ROOT` | Согласованный внешний Git-каталог, один родительский read-only bind без вложенных mounts |
| `PRODUCTION_SECRETS_DIR` | Закрытый каталог secrets вне checkout |
| `PRODUCTION_SMTP_TLS_DIR`, `PRODUCTION_SMTP_HOST`, `PRODUCTION_SMTP_PORT` | Private TLS bundle, имя сертификата и порт SMTP; до cutover `2525` на loopback |
| `PRODUCTION_MEDIA_PUBLIC_IP`, `PRODUCTION_MEDIA_MIN_PORT`, `PRODUCTION_MEDIA_MAX_PORT` | Реальный media IP и зарезервированный диапазон UDP/TCP |

Дополнительные настройки заданы явно в Compose: Git/monitoring allowlists и квоты,
ICE/TURN, Яндекс OAuth, Web Push, AI и frontend analytics. Не включайте функции
до настройки соответствующего провайдера. Для действующих пользователей сохраняйте
исходные JWT, VAPID и Git credential keys. Изменение JWT сломает проверку старых
SHA1-паролей. SMTP также требует JWT: его Nest-модули включают AuthModule.
`PRODUCTION_OPENROUTER_MODEL` и `PRODUCTION_OPENROUTER_TRANSCRIBE_MODEL` сохраняют
выбранные модели AI. По умолчанию используются `google/gemini-2.0-flash-001`
и `openai/whisper-large-v3-turbo`, как в приложении.

Файлы secrets перечислены в конце Compose. Обязательны database passwords,
JWT, tenancy proxy, admin password hash, storage keys, Git credential key,
`git_external_repositories_json`, `mail_tenants_json` и `pgbackrest_config`.
JSON без настроенных подключений содержит `[]`, а не пустую строку. Для нового
развертывания без внешних репозиториев используйте отдельный пустой read-only
каталог и пустой список привязок, не системный каталог.

Файлы `turn_secret`, `vapid_public_key`, `vapid_private_key`, `yandex_client_secret`,
`openai_api_key`, `openrouter_api_key`, `sentry_dsn` также существуют, но могут быть
пустыми, если соответствующая функция отключена. Credentials не передаются в
Docker build args или tracked env. Каталог secrets закрыт от других пользователей;
доступ к конкретным bind-файлам выдаётся только UID использующего их контейнера.
Для `pgbackrest_config` нужен PostgreSQL UID 999 и права `0400`/`0600`.
Не расширяйте доступ ко всему каталогу ради PgBouncer UID 10001.

Наличие `pg_stat_statements` в `shared_preload_libraries` проверяет оператор
инфраструктуры под PostgreSQL administrator. Migration-role проверяет свою роль,
владельца БД и установленное расширение, но не читает привилегированные настройки.
Не выдавайте ей `pg_read_all_settings` ради такой проверки.

Bootstrap PostgreSQL выполняется как UID 999, PgBouncer как UID 10001. Поэтому
два runtime-пароля имеют отдельные закрытые файлы с одинаковыми значениями:

| Файлы | Владелец и права | Потребитель |
| --- | --- | --- |
| `data_password`, `platform_password` | UID/GID `10001:0`, `0440` | PgBouncer читает как owner, backend/SMTP как group 0 |
| `bootstrap_data_password`, `bootstrap_platform_password` | UID/GID `999:999`, `0400` | Только PostgreSQL init, с target `data_password`/`platform_password` |
| `data_migrator_password`, `platform_migrator_password` | UID/GID `999:0`, `0440` | PostgreSQL читает как owner, migration job как group 0 |
| `postgres_password`, `pgbackrest_config` | UID/GID `999:999`, `0400` | Только PostgreSQL/pgBackRest |
| Остальные runtime secrets | UID/GID `0:0`, `0400` | Соответствующий app runtime |

Генератор должен создать каждый пароль один раз и записать его в оба соответствующих
файла без вывода значения. Не генерируйте aliases независимо. Перед первым init
сравните пары побайтово и проверьте owner/mode. Не делайте secrets world-readable
и не пытайтесь решить различие UID через Compose `uid` для file-backed secrets:
локальный Compose использует исходные bind-файлы. Init на существующем PG volume
не обновляет пароли ролей: их ротация требует отдельной согласованной процедуры.
App/migration runtime имеет UID/GID `0:0`, но `cap_drop: ALL`: root без
`CAP_DAC_OVERRIDE` не читает чужой `0400`. Поэтому только совместно используемые
пароли имеют точечное чтение group 0 (`0440`), остальные остаются `0400`.
Host-каталог secrets принадлежит root и закрыт `0700`; дополнительных host-групп,
ACL и world-read нет. Этот контракт проверяет реальный Docker auth smoke.

## Сеть и health

Backend использует host network ради медиапортов, но HTTP привязан строго к
`127.0.0.1`. `BACKEND_BIND_HOST` принимает только IP literal. Вне этой production
конфигурации отсутствие переменной сохраняет прежнее поведение приложения.
Frontend тоже слушает только loopback. PostgreSQL вообще не
публикует порт хоста; Redis и PgBouncer публикуются только на loopback.
Проверьте host firewall и поведение loopback port publishing установленной
версии Docker до допуска внешнего трафика.

Gateway работает как UID/GID `101:101`, без capabilities и с read-only root.
Три writable tmpfs принадлежат этому UID. Проверяйте выбранный immutable Nginx
образ реальным start/HTTP smoke, а не только `nginx -t`.

Внешний TLS proxy на этом же хосте подключается к private ingress. Если proxy
работает в bridge-контейнере, loopback хоста ему недоступен: выберите доступный
RFC1918 интерфейс хоста через обязательный `PRODUCTION_INGRESS_BIND_IP`.
Проверьте принадлежность адреса хосту, маршрут из proxy и host firewall.
Не используйте внешний интерфейс, wildcard bind или public IP. Private адрес
сам по себе не ограничивает доступ других контейнеров или VPN-клиентов;
до cutover proxy не должен направлять публичный трафик в новый ingress.
Health проверяет этот же адрес. Backend и frontend остаются на loopback.
Внешний proxy должен
сохранить исходный Host и WebSocket upgrade и не пропускать публичные заголовки
внутренней подписи. Внутренний gateway тоже удаляет эти заголовки. Не добавляйте
в него public bind. Проверка Compose не доказывает, что существующий внешний
proxy или firewall не направляет туда трафик: это отдельная операторская проверка.

API health проверяет HTTP, обе БД и Redis. Frontend проверяет SSR admin page.
Health и precutover SQL используют read-only транзакции с `SET LOCAL
statement_timeout`. Не передавайте этот параметр в startup packet через
PgBouncer и не отключайте его проверку через `ignore_startup_parameters`.
SMTP health проверяет EHLO, STARTTLS, доверенную цепочку, hostname/срок сертификата
и обе БД, не отправляя письмо. Закрытый TLS bundle монтируется целиком, чтобы
обновление `current` не оставляло контейнер на старом inode. См. [обновление
сертификата SMTP](../../docs/saas-mail.md).

Отдельный backend watchdog проверяет живость event loop каждые 5 секунд.
После двух ошибок он завершает всю process group, включая mediasoup, затем
Docker перезапускает контейнер. Для первого старта есть 120 секунд. SMTP получает
до 45 секунд на drain, Docker stop grace составляет 60 секунд. Docker health
сам по себе не перезапускает unhealthy SMTP/frontend: отказ должен попадать
в эксплуатационные уведомления.

Media worker создается при старте, а сетевые media transports при входе в звонок.
До cutover не входите в комнаты новой копии с диапазоном действующего backend.
После freeze старого backend проверьте реальные звонки, экран и TURN из внешних
сетей. TURN нужен для сетей, запрещающих прямое соединение; Redis его не заменяет.

## Проверка конфигурации без запуска

### DNS/TLS gate при подключении клиента

В первом релизе внешний proxy использует точные hostname для основного клиента
и admin. Старый адрес приложения перенаправляется на канонический только после
cutover. On-demand TLS и автоматического изменения DNS сейчас нет: создание
пространства в админке само по себе не делает поддомен доступным.

Для каждого следующего клиента оператор отдельно проверяет:

1. Пространство создано через внутреннюю админку и успешно provisioned. Hostname
   совпадает с записью platform database. Служебные поддомены `admin`, `auth`,
   `api`, `app`, `preprod`, `www`, `mail`, `smtp`, `media`, `status`, `static`
   запрещены. API изменения slug/hostname нет.
2. A/AAAA нового точного имени указывают на согласованный ingress. Неверный AAAA
   исправлен; наличие wildcard DNS не заменяет эту проверку.
3. Внешний proxy получил точный host route в нужный private ingress. Конфигурация
   проверена перед graceful reload; старые приложения и proxy-контейнер не
   перезапускаются. Неподтвержденные tenant/proxy headers удаляются.
4. Сертификат реально выпущен и доверен, SAN соответствует новому hostname.
   Проверены вход, API, WebSocket и отрицательный доступ с чужой tenant-сессией.
   Только после этого ссылка передается клиенту.

Обычный stock Caddy может выпускать сертификаты точных имен через HTTP/TLS-ALPN,
если DNS и порты ACME доступны. Wildcard-сертификат требует DNS challenge с
поддерживаемым provider-модулем; его наличие не предполагается.
См. [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Для автоматического onboarding позже нужен отдельный защищенный TLS ask endpoint
с точным indexed lookup разрешенного hostname в platform database и отказом
при ошибке. Он не должен создавать tenants, определять tenant из пользовательского
заголовка или выдавать разрешение только по суффиксу домена. В текущем backend
такого endpoint нет; включать on-demand без него нельзя.

### Статическая проверка Compose

Разрешите все обязательные значения в private env. Эта команда проверяет Compose,
но не обращается к Docker daemon для запуска контейнеров. Не печатайте raw config:

```sh
docker compose --project-name example-production --env-file /private/production.env \
  -f deploy/production/compose.yml --profile deployment --profile backup \
  config --format json | node deploy/production/validate.mjs example-production precutover
```

Включите `pipefail` в оболочке, выполняющей команду. Проверка отвергает изменяемые
теги, неожиданные сервисы, общий внешний volume, публичный HTTP/Redis/PgBouncer,
активные staging jobs и SMTP port 25 до cutover. Она не проверяет доступность
провайдеров, наличие свободной памяти или владение выбранным адресом.

Сумма верхних memory limits постоянно работающих сервисов составляет около
2.2 GiB, backup добавляет 256 MiB, migrate до 768 MiB. Это ограничения, не обещание
фактического потребления. Учитывайте одновременно работающий старый контур,
page cache, WAL и место для восстановления. Не собирайте образы на production,
не удаляйте чужие Docker volumes/images/cache ради освобождения места.

## Первый перенос

1. Зафиксируйте точные app commit/image IDs, source DB fingerprint, UUID клиента,
   исходные secret keys, список файлов и Git-привязок. Проверьте offhost backup
   и восстановление. Старый deploy hook не должен запускать прежний общий Compose
   после переключения. Его замена согласуется отдельно.
2. Поднимите только инфраструктуру нового project с отдельным data volume.
   Существующий общий PostgreSQL не перезапускается. Новый PG с первого старта
   использует checksums, `pg_stat_statements`, WAL archiving и отдельные роли.
   Создайте pgBackRest stanza и проверьте отправку WAL до приёма пользовательских
   записей. Init scripts действуют только на пустом volume и не меняют пароли
   уже созданного кластера при повторном запуске.
3. Восстановите согласованную копию только исходной рабочей БД в `nervion_data_1`.
   Владельцы business tables, sequences и metadata tables должны стать
   `nervion_data_migrator`. Не переносите cluster roles, чужие БД, ownership/ACL
   старого runtime. Extensions создаёт privileged init; исключите соответствующие
   extension/comment TOC entries из восстановления под ограниченной migration role.
4. Отдельный one-time baseline stage проверяет `legacy-baseline-v1.json` на новой
   копии. Если старые business migrations отсутствуют, примените их только здесь,
   после rehearsal и до tenant conversion. Никогда не запускайте legacy DataSource
   на tenant-converted schema или на старой live БД.
5. Для первого пустого platform schema выполните отдельный `migrate --bootstrap-schema`
   с `phase=precutover`. Он делает только platform/tenant DDL. Режим отказывается
   работать, если уже есть tenant, и не используется обычным release runner.
   Затем отдельно выполните `bootstrap-existing-tenant`, используя исходный JWT,
   UUID и согласованные hostname/slug. Проверьте identities, memberships и
   контрольные суммы исходных записей.
6. До запуска новой копии переведите **все** её tenants в `read_only` и явно
   установите `feature_flags.mail=false`, jobs оставьте выключенными. Сохраните
   прежние значения для последующего восстановления. Это временная блокировка
   копии, не изменение старого live клиента. Новая копия не должна создавать
   tenant или менять эти flags во время проверки. Mail outbox запускается и
   в API, и в SMTP, независимо от generic jobs switch. Закрытый ingress сам по
   себе не предотвращает отправку писем.
7. Normal migration job проверяет baseline, владельцев, роли, extension и реальные
   precutover-флаги SQL до DDL и после него. API/SMTP повторяют read-only SQL preflight
   до запуска процесса. Проверяйте копию через private ingress без отправки писем,
   фоновых изменений и входа в голосовые комнаты. Пройдите API/RLS/Host/JWT/files/Git
   и PgBouncer isolation acceptance из [SaaS-инструкции](../../docs/saas.md).
8. Для финального переноса остановите **все** старые writers: API, SMTP и фоновые
   процессы. Проверьте отсутствие продолжающихся операций. Сделайте final backup,
   восстановите/сверьте финальную копию и выполните последний storage checkpoint.
   Пока это не подтверждено, не открывайте запись новой копии.
9. Сохраните private evidence с точными backup/restore/storage/stop checkpoints,
   переключите manifest/env на `live`, выполните новый prepare/migrate/deploy.
   Верните согласованные tenant flags только на новой БД. SMTP port 25 и публичный
   ingress переключаются отдельными явными операциями после остановки старых
   сервисов. Сохраните совместимость старых API/WS/webhook адресов; редирект страницы
   не заменяет совместимость интеграций. Проверяйте единственного writer.

После новых пользовательских записей возврат ingress на старую копию БД потеряет
новые изменения. Такой rollback запрещён без reconciliation или восстановления
нового primary. До открытия записи старые volumes и стек сохраняются для
согласованного быстрого возврата. Никакой автоматической очистки старых данных нет.

## Evidence и повторяемый релиз

Production backend помечен `io.nervion.release.production=true`. Для него
[release runner](../release/README.md) требует `manifest.dataState`:

```json
{
  "phase": "precutover",
  "evidenceFile": "/private/release-state/cutover-evidence.json"
}
```

Evidence закрыт правами `0600`, привязан к project, commit, phase, bootstrap UUID,
времени проверки и сроку действия не более 24 часов. Его SHA-256 входит в release
fingerprint. Изменение данных или истечение срока требует нового подтверждения
и prepare. Формат и обязательные checkpoints описаны в инструкции runner.
Evidence фиксирует действие оператора, а не автоматически останавливает процессы,
создает backup или доказывает настройки внешнего proxy. SQL precutover gate
проверяет состояние целевой platform database независимо от этих утверждений.

## Backup и PITR

pgBackRest шифрует backup и WAL до загрузки в отдельный закрытый S3 prefix.
Используются стандартный `aes-256-cbc`, отдельные минимальные S3 credentials,
35-дневное хранение full backup и необходимого WAL. Шифрующий passphrase хранится
вне репозитория и имеет отдельную защищенную копию вне VDS. Потеря ключа означает
потерю возможности восстановления. Application storage keys не выдаются backup job.

Systemd timers выполняют weekly full/daily differential и hourly freshness check.
Настройка и monitor SQL находятся в [postgres](./postgres/README.md). Отказ задания,
рост `pg_wal`, отсутствие успешной архивации, свободный диск, память и подключения
требуют уведомления оператору. Не задавайте `archive-push-queue-max`: при достижении
этого лимита pgBackRest отбрасывает WAL и разрывает PITR. При недоступности S3 WAL
сохраняется локально, поэтому дисковый мониторинг обязателен.

Перед cutover обязательны local full/diff/PITR fixture и отдельная проверка
зашифрованной записи в реальное S3 с последующим восстановлением. Локальный POSIX
тест не доказывает bucket policy, доступность S3 или сохранность внешнего ключа.
Backup PostgreSQL не включает application S3 objects, исходные Git-хранилища,
TLS bundle и runtime secrets. Их сохранность и version/retention проверяются отдельно.

Поведение шифрования и retention описано в [pgBackRest User Guide](https://pgbackrest.org/user-guide.html),
а последствия archive queue limit в [Configuration Reference](https://pgbackrest.org/configuration.html).

## Локальные проверки

```sh
node --test deploy/production/production.test.mjs
node --test deploy/production/health.test.mjs
node --test deploy/release/run.test.mjs
pnpm --filter backend exec jest --runInBand src/common/utils/backend-bind-host.spec.ts
node deploy/production/gateway-smoke.mjs sha256:<verified-local-nginx-image-id>
node deploy/production/database-auth-smoke.mjs sha256:<verified-local-postgres-image-id> sha256:<verified-local-pgbouncer-image-id>
```

Эти проверки не выполняют production deploy. Отдельные Docker restore fixtures
используют только временные локальные volumes, без доступа к реальным данным.
Gateway smoke запускает временный non-root контейнер с `--network none`, без
публикации портов и без pull; HTTP проверяется внутри его сетевого namespace.
Database auth smoke создает пустой временный PostgreSQL и PgBouncer в закрытой
сети без published ports и без egress. Он проверяет UID/права secret aliases,
SCRAM-вход обеих ролей и отказ неверного пароля/чужой БД, затем удаляет только
свой временный project и его пустые data volumes. WAL/S3 проверяет отдельный
backup fixture, в auth smoke archiving не запускается.
