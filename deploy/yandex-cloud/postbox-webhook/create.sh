#!/usr/bin/env bash
# Создаёт Cloud Function + триггер Data Streams → Nervion webhook.
# Требует: yc init (профиль с доступом к каталогу b1gitf9i2nhtkmpedo90).
set -euo pipefail

FOLDER_ID="${FOLDER_ID:-b1gitf9i2nhtkmpedo90}"
FUNCTION_NAME="${FUNCTION_NAME:-nervion-postbox-webhook}"
TRIGGER_NAME="${TRIGGER_NAME:-nervion-postbox-events}"
STREAM_NAME="${STREAM_NAME:-postbox-events}"
# Полный путь БД YDB для Data Streams (не только id).
YDB_DATABASE="${YDB_DATABASE:-/ru-central1/b1gohnhmv11qt3af57hs/etnimgsmr4tfr51si6ld}"
WEBHOOK_URL="${WEBHOOK_URL:-https://app.nervion.ru/api/mailbox/postbox-events}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:?Задайте WEBHOOK_SECRET (= POSTBOX_EVENTS_WEBHOOK_SECRET)}"
SA_NAME="${SA_NAME:-nervion-postbox-webhook}"
RUNTIME="${RUNTIME:-nodejs18}"
DIR="$(cd "$(dirname "$0")" && pwd)"

yc config set folder-id "$FOLDER_ID" >/dev/null

echo "==> Сервисный аккаунт $SA_NAME"
if ! yc iam service-account get --name "$SA_NAME" >/dev/null 2>&1; then
  yc iam service-account create --name "$SA_NAME" --description "Postbox events → Nervion"
fi
SA_ID="$(yc iam service-account get --name "$SA_NAME" --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"

echo "==> Роли на каталог для $SA_ID"
yc resource-manager folder add-access-binding "$FOLDER_ID" \
  --role yds.editor \
  --subject "serviceAccount:$SA_ID" >/dev/null || true
yc resource-manager folder add-access-binding "$FOLDER_ID" \
  --role functions.functionInvoker \
  --subject "serviceAccount:$SA_ID" >/dev/null || true
yc resource-manager folder add-access-binding "$FOLDER_ID" \
  --role serverless.functions.invoker \
  --subject "serviceAccount:$SA_ID" >/dev/null || true
yc resource-manager folder add-access-binding "$FOLDER_ID" \
  --role functions.editor \
  --subject "serviceAccount:$SA_ID" >/dev/null || true

echo "==> Функция $FUNCTION_NAME"
if ! yc serverless function get --name "$FUNCTION_NAME" >/dev/null 2>&1; then
  yc serverless function create --name "$FUNCTION_NAME" --description "Postbox Data Streams → Nervion"
fi

# В архив версии не тащим README/create.sh — только handler.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$DIR/index.js" "$STAGE/index.js"

yc serverless function version create \
  --function-name "$FUNCTION_NAME" \
  --runtime "$RUNTIME" \
  --entrypoint index.handler \
  --memory 128m \
  --execution-timeout 30s \
  --source-path "$STAGE" \
  --service-account-id "$SA_ID" \
  --environment "WEBHOOK_URL=$WEBHOOK_URL,WEBHOOK_SECRET=$WEBHOOK_SECRET"

FUNC_ID="$(yc serverless function get --name "$FUNCTION_NAME" --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"

echo "==> Триггер $TRIGGER_NAME → поток $STREAM_NAME"
if yc serverless trigger get --name "$TRIGGER_NAME" >/dev/null 2>&1; then
  echo "Триггер уже есть, пропускаю создание"
else
  yc serverless trigger create yds \
    --name "$TRIGGER_NAME" \
    --database "$YDB_DATABASE" \
    --stream "$STREAM_NAME" \
    --stream-service-account-id "$SA_ID" \
    --batch-size 1k \
    --batch-cutoff 1s \
    --invoke-function-id "$FUNC_ID" \
    --invoke-function-service-account-id "$SA_ID"
fi

echo "Готово. Функция: $FUNCTION_NAME ($FUNC_ID)"
