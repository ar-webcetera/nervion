import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';

// DSN берётся из env (NUXT_PUBLIC_SENTRY_DSN). Пусто = Sentry выключен.
const dsn = useRuntimeConfig().public.SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: true,
  });
}
