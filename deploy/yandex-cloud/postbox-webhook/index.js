/**
 * Cloud Function: Data Streams (Postbox events) → Nervion webhook.
 *
 * Env:
 *   WEBHOOK_URL    — https://app.nervion.ru/api/mailbox/postbox-events
 *   WEBHOOK_SECRET — значение POSTBOX_EVENTS_WEBHOOK_SECRET
 *
 * Entry point: index.handler
 */
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

module.exports.handler = async function handler(event) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_URL и WEBHOOK_SECRET обязательны');
  }

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WEBHOOK_SECRET}`,
    },
    body: JSON.stringify(event ?? {}),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Webhook ${response.status}: ${text.slice(0, 500)}`);
  }

  return {
    statusCode: 200,
    body: text,
  };
};
