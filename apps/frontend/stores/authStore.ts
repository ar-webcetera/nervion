import { defineStore } from 'pinia';
import { useUserStore } from '~/stores/userStore';
import type { User } from '~/types/user';
import { waitForServiceWorker } from '~/services/pushSubscription';

export const useAuthStore = defineStore('auth', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const userStore = useUserStore();

  const unsubscribePushOnLogout = async () => {
    if (!import.meta.client) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const registration = await waitForServiceWorker(navigator.serviceWorker);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await tenantFetch(`/api/push/unsubscribe`, {
        baseURL: tenantApiBaseUrl,
        method: 'DELETE',
        credentials: 'include',
        timeout: 15000,
        body: {
          endpoint: subscription.endpoint,
        },
      });
    } catch {
      // Локальная подписка всё равно удаляется в finally.
    } finally {
      await subscription.unsubscribe().catch(() => {});
    }
  };

  const loginByEmail = async (params: Record<string, string>) => {
    const response = await tenantFetch<User>(`/api/auth/login/email`, {
      baseURL: tenantApiBaseUrl,
      method: 'POST',
      credentials: 'include',
      body: params,
    });
    userStore.user = response;
    return response;
  };

  const logout = async () => {
    await unsubscribePushOnLogout().catch(() => {});
    await tenantFetch(`/api/auth/logout`, {
      baseURL: tenantApiBaseUrl,
      method: 'POST',
      credentials: 'include',
    });
    userStore.user = null;
  };

  const unlinkYandex = async () => {
    await tenantFetch<{ yandex_linked: false }>(`/api/auth/yandex/unlink`, {
      baseURL: tenantApiBaseUrl,
      method: 'POST',
      credentials: 'include',
    });
    if (userStore.user) {
      userStore.user = { ...userStore.user, yandex_linked: false };
    }
  };

  return { loginByEmail, logout, unlinkYandex };
});
