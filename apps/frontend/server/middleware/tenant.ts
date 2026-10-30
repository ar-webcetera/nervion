import { createHmac } from 'node:crypto';
import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  if (String(config.public.tenancyEnabled) !== 'true') return;

  const rawHost = (getHeader(event, 'host') ?? '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/.test(rawHost)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный Host' });
  }
  const hostname = rawHost.replace(/:\d+$/, '');
  const root = String(config.public.tenancyRootDomain).toLowerCase();
  const admin = String(config.public.platformAdminHost).toLowerCase();
  const allowedHosts = String(config.tenancyAllowedHosts).split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const suffix = `.${root}`;
  const slug = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : '';
  const isTenantHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
  if (hostname !== admin && !isTenantHost && !allowedHosts.includes(hostname)) {
    throw createError({ statusCode: 404, statusMessage: 'Пространство не найдено' });
  }
  if (String(config.tenancyProxySecret).length < 32) {
    throw createError({ statusCode: 503, statusMessage: 'Маршрутизация пространств не настроена' });
  }

  const timestamp = String(Date.now());
  event.context.nervionTenantHeaders = {
    'x-nervion-host': hostname,
    'x-nervion-timestamp': timestamp,
    'x-nervion-signature': createHmac('sha256', String(config.tenancyProxySecret)).update(`${timestamp}\n${hostname}`).digest('hex'),
  };
  if (!event.path.startsWith('/_nuxt/')) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store');
    setResponseHeader(event, 'CDN-Cache-Control', 'no-store');
    setResponseHeader(event, 'Vary', 'Host, Cookie');
  }
});
