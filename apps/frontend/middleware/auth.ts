import { useUserStore } from '~/stores/userStore';
import type { User } from '~/types/user';

export default defineNuxtRouteMiddleware(async (to) => {
  const userStore = useUserStore();
  const tenantStore = useTenantStore();

  const headers = import.meta.server ? useApiRequestHeaders() : undefined;

  try {
    const user = await $fetch<User>('/api/auth/me', {
      baseURL: useApiBaseUrl(),
      credentials: 'include',
      method: 'GET',
      headers,
    });
    userStore.user = user || null;
    await tenantStore.load();
    const routeAccount =
      to.name === 'mail' ? Number(Array.isArray(to.query.account) ? to.query.account[0] : to.query.account) : 0;
    useState<number>('mail-selected-account-id', () => 0).value =
      Number.isInteger(routeAccount) && routeAccount > 0 ? routeAccount : (user?.selected_mail_account_id ?? 0);

    if (to.name === 'login') {
      return navigateTo(tenantStore.getLandingPath(user.role), { replace: true });
    }
  } catch {
    userStore.user = null;
    tenantStore.tenant = null;

    if (to.name !== 'login') {
      return navigateTo('/login', { replace: true });
    }
  }

  if (userStore.user) {
    if (!tenantStore.routeAllowed(to.path)) {
      if (to.path === '/') return navigateTo(tenantStore.getLandingPath(userStore.user.role), { replace: true });
      throw createError({ statusCode: 403, statusMessage: 'Раздел недоступен в этом пространстве' });
    }
  }
});
