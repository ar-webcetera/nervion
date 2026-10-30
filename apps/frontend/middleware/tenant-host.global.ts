export default defineNuxtRouteMiddleware((to) => {
  const config = useRuntimeConfig();
  const isPlatformPath = to.path === '/platform' || to.path.startsWith('/platform/');
  if (String(config.public.tenancyEnabled) !== 'true') {
    if (isPlatformPath) throw createError({ statusCode: 404, statusMessage: 'Страница не найдена' });
    return;
  }
  const hostname = import.meta.server
    ? String(useRequestHeaders(['host']).host ?? '').toLowerCase().replace(/:\d+$/, '')
    : window.location.hostname.toLowerCase();
  const isAdminHost = hostname === String(config.public.platformAdminHost).toLowerCase();
  if (isAdminHost && !isPlatformPath) return navigateTo('/platform', { replace: true });
  if (!isAdminHost && isPlatformPath) throw createError({ statusCode: 404, statusMessage: 'Страница не найдена' });
});
