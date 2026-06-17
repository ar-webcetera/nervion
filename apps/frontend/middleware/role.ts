import { useUserStore } from '~/stores/userStore';

export default defineNuxtRouteMiddleware((to) => {
  const userStore = useUserStore();

  if (to.meta.roles !== undefined && !to.meta.roles.includes(userStore.user?.role || '')) {
    throw createError({ statusCode: 403 });
  }
});
