import * as Sentry from "@sentry/nestjs";

// Инициализируем Sentry/GlitchTip только если задан DSN.
// Без DSN (например, локально) init не вызываем — SDK остаётся no-op.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0,
  });
}
