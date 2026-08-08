# Postbox events → Nervion webhook

Cloud Function: читает события из Data Streams (configuration set Postbox) и шлёт их в Nervion.

## Параметры

| Env | Значение |
| --- | --- |
| `WEBHOOK_URL` | `https://app.nervion.ru/api/mailbox/postbox-events` |
| `WEBHOOK_SECRET` | тот же секрет, что `POSTBOX_EVENTS_WEBHOOK_SECRET` на backend |

Entry point: `index.handler`. Runtime: Node.js 18+.

## Создание в консоли / CLI

Каталог: `default` (`b1gitf9i2nhtkmpedo90`).

### Через CLI (предпочтительно)

```bash
# один раз: yc init (OAuth в браузере), выбрать cloud/folder default
export PATH="$HOME/yandex-cloud/bin:$PATH"   # если ставили локально
export WEBHOOK_SECRET='…тот же, что POSTBOX_EVENTS_WEBHOOK_SECRET…'
./deploy/yandex-cloud/postbox-webhook/create.sh
```

### Через консоль

1. **Сервисный аккаунт** (если ещё нет) с ролями:
   - `yds.editor` (или `yds.admin`) на поток `postbox-events`
   - `functions.functionInvoker` на функцию
2. **Cloud Functions → Создать функцию** `nervion-postbox-webhook`
   - Загрузить `index.js` из этой папки
   - Entry point: `index.handler`
   - Переменные окружения: `WEBHOOK_URL`, `WEBHOOK_SECRET`
   - Сервисный аккаунт с правом вызова функции
3. **Триггер → Data Streams**
   - Поток: `postbox-events` (YDB `postbox-ydb` / `etnimgsmr4tfr51si6ld`)
   - Функция: `nervion-postbox-webhook`
   - Batch size: 1–10 по вкусу

После деплоя backend с `POSTBOX_CONFIGURATION_SET=nervion-mail` новые исходящие письма получают тег и configuration set; события Delivery/Open/… попадают в поток и на webhook.

## Проверка

```bash
# вручную дернуть webhook (должен ответить accepted/ignored)
curl -sS -X POST 'https://app.nervion.ru/api/mailbox/postbox-events' \
  -H "Authorization: Bearer $POSTBOX_EVENTS_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventType":"Delivery","eventId":"manual-test","mail":{"messageId":"несуществующий"}}'
```

Ожидается JSON с `accepted`/`ignored` (без 401). Реальную доставку смотрите в логах функции и в UI «Статистика» после отправки письма.