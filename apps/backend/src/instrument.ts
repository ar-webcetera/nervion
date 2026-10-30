import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Integration forms carry PATs and platform credentials. Keep route/error
      // diagnostics, never request bodies, cookies or authentication headers.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split('?')[0];
      }
      if (process.env.TENANCY_ENABLED === 'true') {
        delete event.user;
        delete event.extra;
        delete event.breadcrumbs;
      }
      return event;
    },
  });
}
