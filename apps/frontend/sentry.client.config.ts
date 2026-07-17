import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';

const dsn = useRuntimeConfig().public.SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: true,
  });
}
