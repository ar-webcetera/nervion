import { defineStore } from 'pinia';
import { useUserStore } from '~/stores/userStore';
import type { User } from '~/types/user';

export const useAuthStore = defineStore('auth', () => {
  const config = useRuntimeConfig();
  const userStore = useUserStore();

  const unsubscribePushOnLogout = async () => {
    if (!import.meta.client) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await $fetch(`/api/push/unsubscribe`, {
        baseURL: config.public.API_URL,
        method: 'DELETE',
        credentials: 'include',
        body: {
          endpoint: subscription.endpoint,
        },
      });
    } catch {
      // Если backend не принял отписку (например, токен уже истёк), всё равно удаляем локальную подписку.
    } finally {
      await subscription.unsubscribe().catch(() => {});
    }
  };

  const loginByEmail = async (params: Record<string, string>) => {
    const response = await $fetch<User>(`/api/auth/login/email`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      body: params,
    });
    userStore.user = response;
    return response;
  };

  const logout = async () => {
    await unsubscribePushOnLogout().catch(() => {});
    await $fetch(`/api/auth/logout`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
    });
    userStore.user = null;
  };

  const unlinkYandex = async () => {
    await $fetch<{ yandex_linked: false }>(`/api/auth/yandex/unlink`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
    });
    if (userStore.user) {
      userStore.user = { ...userStore.user, yandex_linked: false };
    }
  };

  return { loginByEmail, logout, unlinkYandex };
});
