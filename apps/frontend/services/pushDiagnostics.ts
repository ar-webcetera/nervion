import * as Sentry from '@sentry/nuxt';
import type { PushFailureStage } from '~/enums/push.enums';

const reported = new Map<string, number>();
const errorNames = new Set([
  'Error',
  'TypeError',
  'FetchError',
  'AbortError',
  'NotAllowedError',
  'InvalidStateError',
  'NotSupportedError',
  'SecurityError',
  'InvalidAccessError',
  'TimeoutError',
  'NetworkError',
]);

// Принимаем только безопасные поля ошибки. Текст, stack, response и подписку не отправляем.
export const reportPushFailure = (stage: PushFailureStage, error: object | string | number | boolean | null | undefined) => {
  try {
    if (!Sentry.getClient()?.getOptions().dsn) return;
    const details = error as { name?: string; statusCode?: number; status?: number } | null;
    const name = errorNames.has(details?.name ?? '') ? details!.name! : 'Error';
    const code = details?.statusCode ?? details?.status;
    const httpStatus = typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0;
    const fingerprint = ['web_push', stage, name, String(httpStatus)];
    const key = fingerprint.join(':');
    const now = Date.now();
    if (reported.has(key) && now - reported.get(key)! < 300000) return;
    reported.set(key, now);
    Sentry.captureEvent({
      message: `Web push failed: ${stage} (${name})`,
      level: 'error',
      fingerprint,
      tags: { feature: 'web_push', push_stage: stage, error_name: name, http_status: String(httpStatus) },
      contexts: {
        push: {
          permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
          online: navigator.onLine,
          secure_context: window.isSecureContext,
          standalone: window.matchMedia('(display-mode: standalone)').matches,
          service_worker_controlled: Boolean(navigator.serviceWorker?.controller),
        },
      },
    });
  } catch {
    // Сбой мониторинга не должен ломать настройку уведомлений.
  }
};
