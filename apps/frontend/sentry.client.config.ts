import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';

const runtimeConfig = useRuntimeConfig();
const dsn = runtimeConfig.public.SENTRY_DSN as string | undefined;
const tenancyEnabled = String(runtimeConfig.public.tenancyEnabled) === 'true';

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.tags?.feature === 'web_push' || tenancyEnabled) {
        // Автоматические breadcrumbs могут содержать URL endpoint и сетевые запросы.
        delete event.breadcrumbs;
        delete event.request;
        delete event.user;
        delete event.extra;
      }
      return event;
    },
  });
}
