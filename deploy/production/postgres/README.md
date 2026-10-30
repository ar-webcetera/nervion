# PostgreSQL и зашифрованные резервные копии

Образ предназначен для отдельного основного кластера Нервиона на существующем
VDS. Он не меняет старый общий PostgreSQL и не создаёт резервный сервер.
Отказ одного VDS остановит приложение до восстановления. Наличие backup не
означает, что настроены HA или проверено время восстановления.

## Образ и конфигурация

Dockerfile собирается вне production, с контекстом корня репозитория и
`--platform linux/amd64`. Base image PostgreSQL 17.10 закреплён digest.
pgBackRest 2.60.0, libssh2 и стандартный TLS truststore ca-certificates закреплены
точными версиями и SHA256 из официальных APT-репозиториев. Обновления этих pins требуют
новой сборки и проверки восстановления. Если пакет исчез, сборка завершается
ошибкой. Готовый образ используется по digest или точному локальному image ID.
Секреты не входят в build context и слои образа.

Обязательные точки подключения:

- `PGDATA=/var/lib/postgresql/data/pgdata`.
- Полный приватный config из `pgbackrest.conf.example` подключается read-only
  как `/run/secrets/pgbackrest_config`, с владельцем postgres (UID 999) и `0600`.
- Primary использует writable `/var/run/pgbackrest/archive`, backup job использует
  отдельный `/var/run/pgbackrest/backup`. Оба каталога принадлежат postgres.
- Backup job запускается под postgres, видит data volume и общий Unix socket
  `/var/run/postgresql` read-only. PostgreSQL-пользователь backup job: `postgres`.

Config принимает только один S3 repository:
`/nervion-backups/production/pgbackrest`. Вложенная папка отделяет repository от
границы разрешённого префикса провайдера. Нужен ограниченный этим backup-префиксом
ключ с private object access; публичный ACL не используется. Bucket, endpoint,
ключи и случайная passphrase заполняются только в приватном файле оператора.
Passphrase хранится отдельно от VDS и bucket. Без неё восстановление невозможно.

Wrapper проверяет encryption `aes-256-cbc`, TLS, namespace и retention. Другие
секции, repository, per-command overrides и неизвестные options отклоняются;
`PGBACKREST_*` из окружения очищаются. Шифрование выполняет сам pgBackRest до
отправки данных. [Справка pgBackRest](https://pgbackrest.org/configuration.html)

## Архивация и первоначальный запуск

Primary запускается с `shared_preload_libraries=pg_stat_statements`,
`wal_level=replica`, `archive_mode=on`, `archive_timeout=60s` и командой:

```text
/usr/local/bin/nervion-archive-push "%p"
```

Wrapper допускает только WAL внутри фиксированного `PGDATA/pg_wal`, проверяет
имя и realpath, исключает ссылки и передаёт абсолютный путь. pgBackRest не
принимает разделитель `--`, поэтому защита от подстановки опций обеспечивается
проверкой пути. Ошибка сохраняет ненулевой exit code: PostgreSQL повторяет
архивацию и не освобождает этот WAL. Ограничение с отбрасыванием очереди WAL
не применяется. Во время недоступности backup storage нужен контроль свободного
диска. [Архивация PostgreSQL](https://www.postgresql.org/docs/17/continuous-archiving.html)

`extensions.sql` подключается после существующего bootstrap четырёх ролей и
двух баз, только при создании пустого кластера. SQL statistics находятся в
закрытой schema `monitoring` обеих баз. Runtime-роли не получают global monitoring
permissions. `uuid-ossp` создаётся в `public` базы данных приложения.

До открытия записи оператор отдельно выполняет через backup service:
`stanza-create`, `check`, `full`, затем `info`. Допустимые команды wrapper:
`full`, `diff`, `check`, `stanza-create`, `info`. Restore намеренно не является
командой рабочего backup wrapper. Изменение существующего stanza и удаление
данных не автоматизируются.

## Расписание и контроль

`backup-job.sh` устанавливается как `/usr/local/libexec/nervion-backup-job`
с executable bit и защищённым владельцем. `backup-job.env.example` задаёт только
пути и имя Compose project; заполненный файл устанавливается отдельно как
`/etc/nervion-backup/job.env`. Затем оператор устанавливает и включает systemd
units из этого каталога.

`nervion-backup.timer` запускает backup ежедневно в 03:30 UTC: в воскресенье
full, в остальные дни diff. Если full отсутствует или старше недели, следующий
запуск делает full, в том числе после пропущенного воскресенья. Host runner допускает только готовый immutable image
backup service, `user: postgres`, фиксированный entrypoint и `--no-deps`.
`flock` исключает одновременные backup jobs. Read-only мониторинг не блокируется
долгим backup. Сборок и скачивания образов здесь нет.

`repo1-retention-full-type=time` и `repo1-retention-full=35` сохраняют возможность
восстановления за 35 дней, если весь WAL успешно доставлен. Стандартные defaults
удаляют WAL только вместе с истёкшими full backups; diff сохраняются до удаления
их full. Repository может занимать больше 35 дней из-за недельного расписания.
[Retention pgBackRest](https://pgbackrest.org/configuration.html)

`nervion-backup-monitor.timer` проверяет состояние каждый час. Ненулевой код
получается при отсутствии encrypted backup, возрасте последней копии более
36 часов или full более 8 дней. Для monitor задан timeout 120 секунд: зависшая
проверка завершается ошибкой и вызывает OnFailure. Full backup не ограничен этим
таймаутом. Неуспешный backup также остаётся failed systemd
unit с журналом. Шаблоны связывают OnFailure с [операторскими уведомлениями](../ops-alert.md);
получатель и проверка доставки настраиваются отдельно. Receiver на том же VDS
не обнаружит полный отказ хоста. `monitor.sql` даёт администратору
счётчики archiver, возраст ожидающего WAL и его объём. Нужны также alerts по диску.

## Локальная проверка восстановления

После сборки, с точным image ID:

```sh
node deploy/production/postgres/fixture.mjs --image sha256:IMAGE_ID
```

Fixture создаёт только новые volumes, синтетические данные и случайные тестовые
пароли. Все контейнеры работают без сети, без опубликованных портов и без S3.
Проверяются encrypted full/diff, отказ с неправильной passphrase, восстановление
обеих баз на момент до удаления данных, WAL после diff и изоляция monitoring.
Production wrappers отдельно проходят negative tests с подставным executable.
Для POSIX repository fixture вызывает настоящий pgBackRest напрямую, не ослабляя
production-проверку S3 namespace.

Собственные контейнеры останавливаются; volumes, конфиги и диагностика остаются
в новом приватном temp-каталоге. Список ресурсов находится в `resources.json`.
Existing volumes и images не удаляются. Успех фиксируется в `result.json`.

Проверка реального S3 требует отдельного явного разрешения и дополнительного
аргумента `--s3-fixture-config /private/verification.conf`. Это полный закрытый
config с отдельной тестовой passphrase и единственным допустимым namespace
`/nervion-backups/production/verification/<UUID>`. Fixture откажется использовать
непустой namespace или production repository. В этом режиме сеть включена,
но данные остаются синтетическими; проверяется также ciphertext реального S3
объекта. Тестовые зашифрованные объекты сохраняются для проверки и не удаляются
автоматически. Production wrapper по-прежнему принимает только основной prefix.

Production restore сначала выполняется в новый пустой volume, на том же
проверенном image, с исходным приватным config и доступом к backup repository.
Для PITR используется pgBackRest `restore --type=time --target=...` и явный
`--target-action`. В проверочном восстановлении выключают archive mode и
исключают подключение приложения. Нельзя восстанавливать поверх работающего
PGDATA. Полный restore восстанавливает весь кластер, не отдельного tenant.
[Руководство по восстановлению](https://pgbackrest.org/user-guide.html)

Эти копии содержат PostgreSQL. Пользовательские файлы в S3 и остальные внешние
сервисы требуют отдельной политики сохранности и проверки восстановления.
