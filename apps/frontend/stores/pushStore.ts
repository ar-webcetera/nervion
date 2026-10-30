import { defineStore } from 'pinia';
import type { PushTestRequest } from '@tracker/contracts';
import { PushFailureStage, PushStatus } from '~/enums/push.enums';
import { reportPushFailure } from '~/services/pushDiagnostics';
import { getValidPushSubscription, urlBase64ToUint8Array, waitForServiceWorker } from '~/services/pushSubscription';
import { getErrorMessage } from '~/utils/error';

export const usePushStore = defineStore('push', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const userStore = useUserStore();
  const status = ref(PushStatus.Checking);
  const enabled = ref(false);
  const busy = ref(false);
  const message = ref('');
  const showBanner = ref(false);
  let pending: Promise<boolean> | null = null;
  let syncedAt = 0;
  let attemptedAt = 0;
  const disabledKey = 'push-device-disabled';
  const supported = () =>
    import.meta.client &&
    window.isSecureContext &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator;
  const disabled = () => Boolean(localStorage.getItem(disabledKey));
  const dismissed = () => Date.now() < Number(localStorage.getItem('push-banner-dismissed-until') || 0);
  const apiOptions = () => ({ baseURL: tenantApiBaseUrl as string, credentials: 'include' as const, timeout: 15000 });

  const dismissBanner = () => {
    showBanner.value = false;
    localStorage.setItem('push-banner-dismissed-until', String(Date.now() + 86400000));
  };

  const reset = () => {
    syncedAt = 0;
    attemptedAt = 0;
    status.value = PushStatus.Checking;
    enabled.value = false;
    message.value = '';
    showBanner.value = false;
  };

  const connect = async (): Promise<boolean> => {
    const userId = userStore.user?.id;
    if (!userId) return false;
    busy.value = true;
    attemptedAt = Date.now();
    let stage = PushFailureStage.PublicKey;
    try {
      const { key } = await tenantFetch<{ key: string }>('/api/push/vapid-public-key', apiOptions());
      if (!key) throw new Error('Уведомления не настроены на сервере.');
      stage = PushFailureStage.ServiceWorker;
      const registration = await waitForServiceWorker(navigator.serviceWorker);
      stage = PushFailureStage.BrowserSubscription;
      const subscription = await getValidPushSubscription(registration, urlBase64ToUint8Array(key));
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new Error('Не удалось создать подписку. Повторите попытку.');
      if (userStore.user?.id !== userId || disabled()) return false;
      stage = PushFailureStage.SaveSubscription;
      await tenantFetch('/api/push/subscribe', {
        ...apiOptions(),
        method: 'POST',
        body: { endpoint: subscription.endpoint, keys },
      });
      if (userStore.user?.id !== userId) return false;
      if (disabled()) {
        stage = PushFailureStage.UnsubscribeServer;
        await tenantFetch('/api/push/unsubscribe', {
          ...apiOptions(),
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        });
        return false;
      }
      status.value = PushStatus.Enabled;
      enabled.value = true;
      syncedAt = Date.now();
      message.value = '';
      showBanner.value = false;
      return true;
    } catch (error) {
      reportPushFailure(stage, error as Error);
      if (userStore.user?.id === userId) {
        status.value = PushStatus.Error;
        message.value = 'Не удалось подключить уведомления. Проверьте соединение и повторите попытку.';
        showBanner.value = !disabled() && !dismissed();
      }
      return false;
    } finally {
      busy.value = false;
    }
  };

  const sync = (force = false): Promise<boolean> => {
    if (!supported()) {
      status.value = PushStatus.Unsupported;
      showBanner.value = false;
      return Promise.resolve(false);
    }
    if (!userStore.user?.id) {
      showBanner.value = false;
      return Promise.resolve(false);
    }
    if (pending) return pending;
    if (busy.value) return Promise.resolve(false);
    if (Notification.permission === 'denied') {
      status.value = PushStatus.Blocked;
      enabled.value = false;
      showBanner.value = false;
      return Promise.resolve(false);
    }
    if (disabled() || Notification.permission !== 'granted') {
      status.value = localStorage.getItem(disabledKey) === 'pending' ? PushStatus.Error : PushStatus.Disabled;
      enabled.value = status.value === PushStatus.Error;
      if (status.value === PushStatus.Error) message.value = 'Отключение не завершено. Снимите галочку ещё раз.';
      showBanner.value = !disabled() && !dismissed();
      return Promise.resolve(false);
    }
    if (!force && status.value === PushStatus.Enabled && Date.now() - syncedAt < 300000) return Promise.resolve(true);
    if (!force && Date.now() - attemptedAt < 30000) return Promise.resolve(false);
    pending = connect().finally(() => {
      pending = null;
    });
    return pending;
  };

  const enable = async () => {
    if (!supported() || busy.value) return;
    busy.value = true;
    message.value = '';
    try {
      // Запрос разрешения должен оставаться в обработчике нажатия пользователя.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        status.value = permission === 'denied' ? PushStatus.Blocked : PushStatus.Disabled;
        showBanner.value = permission !== 'denied' && !disabled() && !dismissed();
        return;
      }
      localStorage.removeItem(disabledKey);
    } catch (error) {
      reportPushFailure(PushFailureStage.Permission, error as Error);
      status.value = PushStatus.Error;
      message.value = 'Не удалось запросить разрешение. Повторите попытку.';
      return;
    } finally {
      busy.value = false;
    }
    await sync(true);
  };

  const disable = async () => {
    if (!supported() || busy.value) return;
    busy.value = true;
    message.value = '';
    // Сначала запрещаем автоподключение, в том числе в других вкладках.
    localStorage.setItem(disabledKey, 'pending');
    showBanner.value = false;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const results = await Promise.allSettled([
          tenantFetch('/api/push/unsubscribe', {
            ...apiOptions(),
            method: 'DELETE',
            body: { endpoint: subscription.endpoint },
          }),
          subscription.unsubscribe(),
        ]);
        for (const [index, result] of results.entries()) {
          if (result.status === 'rejected') {
            reportPushFailure(
              index === 0 ? PushFailureStage.UnsubscribeServer : PushFailureStage.UnsubscribeBrowser,
              result.reason as Error,
            );
          }
        }
        if (results.every((result) => result.status === 'rejected')) {
          status.value = PushStatus.Error;
          enabled.value = true;
          message.value = 'Не удалось завершить отключение. Проверьте соединение и снимите галочку ещё раз.';
          return;
        }
      }
      localStorage.setItem(disabledKey, '1');
      status.value = PushStatus.Disabled;
      enabled.value = false;
      syncedAt = 0;
    } catch (error) {
      reportPushFailure(PushFailureStage.ReadSubscription, error as Error);
      status.value = PushStatus.Error;
      enabled.value = true;
      message.value = 'Не удалось завершить отключение. Проверьте соединение и снимите галочку ещё раз.';
    } finally {
      busy.value = false;
    }
  };

  const test = async (): Promise<boolean> => {
    if (!supported() || busy.value || !enabled.value) return false;
    busy.value = true;
    message.value = '';
    let stage = PushFailureStage.ReadSubscription;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('Подписка отсутствует. Включите уведомления повторно.');
      const body: PushTestRequest = { endpoint: subscription.endpoint };
      stage = PushFailureStage.Test;
      await tenantFetch('/api/push/test', { ...apiOptions(), method: 'POST', body });
      message.value =
        'Запрос отправлен. Проверьте уведомления устройства. Если ничего нет, проверьте разрешения браузера и Android.';
      return true;
    } catch (error) {
      reportPushFailure(stage, error as Error);
      status.value = PushStatus.Error;
      message.value = getErrorMessage(error);
      syncedAt = 0;
      return false;
    } finally {
      busy.value = false;
    }
  };

  return { status, enabled, busy, message, showBanner, sync, enable, disable, test, reset, dismissBanner };
});
