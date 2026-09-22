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
    const routeAccount =
      to.name === 'mail' ? Number(Array.isArray(to.query.account) ? to.query.account[0] : to.query.account) : 0;
    useState<number>('mail-selected-account-id', () => 0).value =
      Number.isInteger(routeAccount) && routeAccount > 0 ? routeAccount : (user?.selected_mail_account_id ?? 0);

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
