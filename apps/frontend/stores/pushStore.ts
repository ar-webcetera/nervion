import { defineStore } from 'pinia';
import type { PushTestRequest } from '@tracker/contracts';
import { PushStatus } from '~/enums/push.enums';
import { getValidPushSubscription, urlBase64ToUint8Array, waitForServiceWorker } from '~/services/pushSubscription';
import { getErrorMessage } from '~/utils/error';

export const usePushStore = defineStore('push', () => {
  const config = useRuntimeConfig();
  const userStore = useUserStore();
  const status = ref(PushStatus.Checking);
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
  const apiOptions = () => ({ baseURL: config.public.API_URL as string, credentials: 'include' as const, timeout: 15000 });

  const dismissBanner = () => {
    showBanner.value = false;
    localStorage.setItem('push-banner-dismissed-until', String(Date.now() + 86400000));
  };

  const reset = () => {
    syncedAt = 0;
    attemptedAt = 0;
    status.value = PushStatus.Checking;
    message.value = '';
    showBanner.value = false;
  };

  const connect = async (): Promise<boolean> => {
    const userId = userStore.user?.id;
    if (!userId) return false;
    busy.value = true;
    attemptedAt = Date.now();
    try {
      const { key } = await $fetch<{ key: string }>('/api/push/vapid-public-key', apiOptions());
      if (!key) throw new Error('Уведомления не настроены на сервере.');
      const registration = await waitForServiceWorker(navigator.serviceWorker);
      const subscription = await getValidPushSubscription(registration, urlBase64ToUint8Array(key));
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new Error('Не удалось создать подписку. Повторите попытку.');
      if (userStore.user?.id !== userId || disabled()) return false;
      await $fetch('/api/push/subscribe', {
        ...apiOptions(),
        method: 'POST',
        body: { endpoint: subscription.endpoint, keys },
      });
      if (userStore.user?.id !== userId) return false;
      if (disabled()) {
        await $fetch('/api/push/unsubscribe', {
          ...apiOptions(),
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        });
        return false;
      }
      status.value = PushStatus.Enabled;
      syncedAt = Date.now();
      message.value = '';
      showBanner.value = false;
      return true;
    } catch {
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
      showBanner.value = false;
      return Promise.resolve(false);
    }
    if (disabled() || Notification.permission !== 'granted') {
      status.value = localStorage.getItem(disabledKey) === 'pending' ? PushStatus.Error : PushStatus.Disabled;
      if (status.value === PushStatus.Error) message.value = 'Отключение не завершено. Нажмите "Выключить" ещё раз.';
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
    } catch {
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
          $fetch('/api/push/unsubscribe', {
            ...apiOptions(),
            method: 'DELETE',
            body: { endpoint: subscription.endpoint },
          }),
          subscription.unsubscribe(),
        ]);
        if (results.every((result) => result.status === 'rejected')) throw new Error('Unsubscribe failed');
      }
      localStorage.setItem(disabledKey, '1');
      status.value = PushStatus.Disabled;
      syncedAt = 0;
    } catch {
      status.value = PushStatus.Error;
      message.value = 'Не удалось завершить отключение. Проверьте соединение и нажмите "Выключить" ещё раз.';
    } finally {
      busy.value = false;
    }
  };

  const test = async () => {
    if (!supported() || busy.value || status.value !== PushStatus.Enabled) return;
    busy.value = true;
    message.value = '';
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('Подписка отсутствует. Включите уведомления повторно.');
      const body: PushTestRequest = { endpoint: subscription.endpoint };
      await $fetch('/api/push/test', { ...apiOptions(), method: 'POST', body });
      message.value =
        'Запрос отправлен. Проверьте уведомления устройства. Если ничего нет, проверьте разрешения браузера и Android.';
    } catch (error) {
      status.value = PushStatus.Error;
      message.value = getErrorMessage(error);
      syncedAt = 0;
    } finally {
      busy.value = false;
    }
  };

  return { status, busy, message, showBanner, sync, enable, disable, test, reset, dismissBanner };
});
