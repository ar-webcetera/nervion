import { ROLES } from '~/types/user';
export default defineNuxtRouteMiddleware(async (to) => {
  const projectId = Number(to.params.id);
  const headers = useRequestHeaders(['cookie']);
  const userStore = useUserStore();

  if (userStore.user?.role !== ROLES.admin) {
    try {
      await $fetch<void>(`/api/projects/${projectId}/access`, {
        baseURL: useApiBaseUrl(),
        credentials: 'include',
        headers,
      });
    } catch {
      if (import.meta.server) {
        throw createError({ statusCode: 403 });
      }
      return navigateTo({ path: '403' });
    }
  }
});
