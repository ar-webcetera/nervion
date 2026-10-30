# Выпуск готовых SaaS-образов

`run.sh` обновляет только `backend`, `frontend` и, при явном выборе, `smtp`.
Он не собирает образы, не получает код из Git, не переключает ingress и не
управляет PostgreSQL, Redis, PgBouncer или общим proxy. Это runner обновлений
уже подготовленного SaaS-контура, не автоматизация первого переноса базы.

Нужны Bash, jq, flock, coreutils и Docker Compose с `config --format json`,
`up --wait`, `run --pull`. Используется только локальный Docker socket.
Учетная запись runner должна иметь разрешённый оператором доступ к Docker.
Runner не использует `sudo` и не меняет права доступа к daemon.

## Контракт релиза

Соберите backend и frontend вне production из одного точного commit. При сборке
задайте обоим образам OCI label `org.opencontainers.image.revision` с полным SHA.
Label подтверждает заявленную версию сборки, но не заменяет доверенный build
pipeline и проверку происхождения артефактов.

Образы должны быть заранее доставлены на хост. Поддерживаются registry digest
`registry.example.com/team/backend@sha256:...` и точный локальный image ID
`sha256:...` после `docker load`. Изменяемые теги не принимаются. Runner проверяет
revision label, фиксирует config image ID и сверяет его с запущенным контейнером.

Manifest, env, secrets, журналы и state находятся вне репозитория. Manifest и
env имеют права `0600`, каталог state принадлежит runner и имеет права `0700`.
Символические ссылки, неканонические пути и файлы, доступные другим на запись,
отклоняются. Пример формы manifest, значения SHA/digest заменяются реальными:

```json
{
  "schemaVersion": 1,
  "commit": "1111111111111111111111111111111111111111",
  "project": "example-saas-production",
  "composeFile": "/private/releases/example/compose.yml",
  "envFile": "/private/config/production.env",
  "images": {
    "backend": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "frontend": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "services": ["backend", "frontend", "smtp"],
  "healthTimeoutSeconds": 180,
  "migrationTimeoutSeconds": 900
}
```

У выбранных сервисов обязательны Docker healthchecks. `container_name` и `build`
не допускаются. `backend` и `migrate` обязаны иметь `TENANCY_ENABLED="true"`.
Runner добавляет labels версии и переопределяет image только выбранных сервисов
и `migrate`. Сервисы не масштабируются этим runner: ожидается один контейнер
каждого выбранного сервиса.

Compose должен содержать отдельный `migrate` с label:

```yaml
labels:
  io.nervion.release.migration: tenant-only
```

Это явное подтверждение оператора, что job подготовлен для существующей tenant
схемы. Он получает только migration-role secrets и выполняет согласованные
tenant/platform migrations. Нельзя подставлять `deploy/preprod/migrate.mjs`:
тот также выполняет legacy `data-source` и предназначен для другого процесса
подготовки. Runner сам не выбирает SQL или TypeORM data source.

## Порядок

Сначала проверить backup/restore, миграции на копии и совместимость схемы с
текущими приложениями. Остановка записи, перенос данных и первый cutover
выполняются отдельным согласованным планом. Runner не считает наличие manifest
доказательством пригодности backup или допустимости live-миграции.

```sh
bash deploy/release/run.sh prepare \
  --manifest /private/releases/commit.json --state-dir /private/release-state \
  --project example-saas-production --expected-commit FULL_COMMIT_SHA
bash deploy/release/run.sh migrate \
  --manifest /private/releases/commit.json --state-dir /private/release-state \
  --project example-saas-production --expected-commit FULL_COMMIT_SHA
bash deploy/release/run.sh deploy \
  --manifest /private/releases/commit.json --state-dir /private/release-state \
  --project example-saas-production --expected-commit FULL_COMMIT_SHA
```

`prepare` не изменяет контейнеры. Он фиксирует Compose, image IDs и hashes
manifest/compose/env и файловых bind/config/secret источников. Содержимое
изменяемых data directories не обходится. Повторное чтение frozen Compose
должно давать ту же конфигурацию. Секреты остаются только в закрытом state.
Хешируются только config/secret файлы выбранных приложений и `migrate`.
Неиспользуемые ими инфраструктурные secrets runner не читает.

Для Compose с backend label `io.nervion.release.production=true` дополнительно
обязателен `manifest.dataState` с `phase` (`precutover`/`live`) и абсолютным
`evidenceFile`. При каждом шаге проверяется private evidence следующей формы:

```json
{
  "schemaVersion": 1,
  "project": "example-saas-production",
  "commit": "1111111111111111111111111111111111111111",
  "phase": "precutover",
  "bootstrapTenantId": "11111111-1111-4111-8111-111111111111",
  "checkedAt": "2026-01-01T10:00:00Z",
  "expiresAt": "2026-01-01T11:00:00Z",
  "checks": {
    "privateIngressVerified": true,
    "backupRestoreVerified": true,
    "legacyStillPrimary": true,
    "noVoiceJoins": true
  },
  "checkpoints": {
    "backupId": "verified-backup-id",
    "restoreVerificationId": "verified-restore-receipt",
    "storageCheckpoint": "verified-storage-checkpoint"
  }
}
```

Даты в примере не разрешают деплой. Evidence должен быть актуальным, со сроком
действия не больше 24 часов и соответствовать точному project/commit/tenant/phase.
Для `live` вместо `legacyStillPrimary`/`noVoiceJoins` обязательны
`legacyApiStopped`, `legacySmtpStopped`, `legacyWorkersStopped`,
`singleWriterConfirmed` и непустой `checkpoints.legacyStopReceipt`.
Эти поля являются подтверждением оператора, не автоматическим выполнением действий.
Runner проверяет loopback HTTP, совпадение phase и выключенные precutover jobs,
запрещает override команды `migrate` и добавляет evidence file в fingerprint.
Реальные precutover SQL-проверки выполняют production migration/runtime entrypoints.
Общий внешний proxy нельзя проверить из application container: private ingress
проверяется оператором отдельно. Подробный [first-cutover runbook](../production/README.md)
не заменяется наличием evidence.

`migrate` запускает только `migrate` с `--no-deps`, проверяет его image и labels,
ждет код завершения `0`, сохраняет receipt. При таймауте или прерывании runner
останавливает только идентифицированный собственный job. Активный старый job
блокирует следующую попытку. Неуспешные job остаются для диагностики. Успешный
одноразовый контейнер удаляется без volumes. Ошибка миграции не запускает deploy.

`deploy` требует receipt для того же commit и fingerprint. Обновление выполняется
с `--no-deps --no-build --pull never` и явным списком сервисов. Затем проверяются
health, project/service labels и image IDs дважды. Ошибки завершают runner
ненулевым кодом; успешный receipt появляется только после всех проверок.
Повторный `prepare` делает прежний migration receipt недействительным.

Операции защищены project-level `flock`. Между отдельными шагами нельзя менять
manifest, compose, env, смонтированные скрипты и secret files. При изменении
runner потребует новый `prepare` и `migrate`. State содержит закрытые диагностику
и журнал результатов. `deployed-head.json` означает последний успешный релиз,
а не гарантирует, что после последующей неудачной попытки контейнеры не изменились.

## Hook

`post-receive` является заменой старого hook, а не дополнительным вызовом.
Установка и изменение production-hook выполняются оператором отдельно. Runner
и hook должны находиться вне checkout, в который пишет Git. Из hook запрещены
сборка на production, `fetch`, `reset`, запуск старого deployment script и
неограниченный `compose up`.
При установке hook должен получить executable bit (`0755`); его владелец и
родительский каталог не должны позволять посторонним менять исполняемый код.
Учетная запись Git-hook должна иметь тот же разрешенный доступ к Docker и
закрытым release-файлам, что и runner. Автоматическое повышение прав не добавляется.

Конфигурация `/etc/nervion-release/hook.json` закрыта правами `0600`:

```json
{
  "schemaVersion": 1,
  "branch": "master",
  "project": "example-saas-production",
  "runner": "/private/release-tools/run.sh",
  "manifestDirectory": "/private/release-manifests",
  "stateDirectory": "/private/release-state"
}
```

Для принимаемого SHA заранее должен существовать `<SHA>.json` и загруженные
проверенные образы. Hook синхронно вызывает три шага для конкретного принятого
SHA. Отсутствующий manifest или провал проверки явно сообщается как deploy
failure. `post-receive` не может отклонить уже принятый Git ref: успешный push
и успешный релиз являются отдельными результатами. Другие ветки и tags не
разворачиваются; удаление `master` не является релизом.

## Откат

Автоматического rollback нет. После изменения схемы возврат старого образа может
быть несовместим с данными. Оператор выбирает проверенную совместимую версию
или выполняет согласованное восстановление. После открытия записи в новой
базе нельзя просто вернуть ingress на старую копию базы без учета новых данных.
Runner не выполняет `down`, `prune`, удаление volumes или старых образов.

Проверки runner используют fake Docker и не запускают контейнеры:

```sh
node --test deploy/release/run.test.mjs
```
