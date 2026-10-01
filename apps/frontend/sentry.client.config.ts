import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';

const dsn = useRuntimeConfig().public.SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: true,
    beforeSend(event) {
      if (event.tags?.feature === 'web_push') {
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
