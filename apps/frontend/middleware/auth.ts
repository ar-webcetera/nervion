import { useUserStore } from '~/stores/userStore';
import type { User } from '~/types/user';

export default defineNuxtRouteMiddleware(async (to) => {
  const userStore = useUserStore();

  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined;

  try {
    const user = await $fetch<User>('/api/auth/me', {
      baseURL: useApiBaseUrl(),
      credentials: 'include',
      method: 'GET',
      headers,
    });
    userStore.user = user || null;

    if (to.name === 'login') {
      return navigateTo('/', { replace: true });
    }
  } catch {
    userStore.user = null;

    if (to.name !== 'login') {
      return navigateTo('/login', { replace: true });
    }
  }
});
