import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
self.skipWaiting();

precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

const normalizeNotificationUrl = (url?: string): string => {
  const serviceWorkerPath = '/sw.js';

  const getNotificationBaseUrl = (): URL => {
    try {
      const scopeUrl = new URL(self.registration.scope);

      if (scopeUrl.pathname.endsWith(serviceWorkerPath)) {
        scopeUrl.pathname = scopeUrl.pathname.slice(0, -serviceWorkerPath.length) || '/';
      }

      if (!scopeUrl.pathname.endsWith('/')) {
        scopeUrl.pathname = `${scopeUrl.pathname}/`;
      }

      scopeUrl.search = '';
      scopeUrl.hash = '';

      return scopeUrl;
    } catch {
      return new URL('/', self.location.origin);
    }
  };

  const normalizeSwPathInUrl = (resolvedUrl: URL): string => {
    if (resolvedUrl.pathname.endsWith(serviceWorkerPath)) {
      resolvedUrl.pathname = resolvedUrl.pathname.slice(0, -serviceWorkerPath.length) || '/';
      resolvedUrl.hash = '';
    }

    return resolvedUrl.toString();
  };

  const notificationBaseUrl = getNotificationBaseUrl();

  try {
    return normalizeSwPathInUrl(new URL(url ?? '/', notificationBaseUrl));
  } catch {
    return notificationBaseUrl.toString();
  }
};

const isClientInAppScope = (client: WindowClient): boolean => {
  try {
    return client.url.startsWith(self.registration.scope);
  } catch {
    return false;
  }
};

const findBestWindowClient = (clients: readonly WindowClient[]): WindowClient | undefined => {
  const inScopeClients = clients.filter(isClientInAppScope);
  return inScopeClients.find((client) => client.visibilityState === 'visible') ?? inScopeClients[0];
};

const focusWindowClient = async (client: WindowClient | null | undefined): Promise<void> => {
  if (!client) return;
  await client.focus().catch(() => {});
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const parsePushPayload = (data: PushMessageData | null): PushPayload | null => {
  if (!data) return null;

  try {
    const jsonPayload = data.json() as Partial<PushPayload>;
    if (typeof jsonPayload.title === 'string' && typeof jsonPayload.body === 'string') {
      return {
        title: jsonPayload.title,
        body: jsonPayload.body,
        url: typeof jsonPayload.url === 'string' ? jsonPayload.url : undefined,
        tag: typeof jsonPayload.tag === 'string' ? jsonPayload.tag : undefined,
      };
    }
  } catch {
    // Ниже обрабатывается текстовый payload.
  }

  const textPayload = data.text();
  if (!textPayload) return null;

  return {
    title: 'Tracker',
    body: textPayload,
    url: '/',
  };
};

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePushPayload(event.data);
  if (!payload) return;

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: payload.tag,
        data: { url: normalizeNotificationUrl(payload.url) },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = normalizeNotificationUrl((event.notification.data as { url?: string } | undefined)?.url);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const windowClients = clients.filter((client): client is WindowClient => 'focus' in client);
      const existing = findBestWindowClient(windowClients);

      if (existing) {
        await focusWindowClient(existing);
        const navigatedClient = await existing.navigate(url).catch(() => null);
        await focusWindowClient(navigatedClient ?? existing);
        return;
      }

      const openedClient = await self.clients.openWindow(url).catch(() => null);
      await focusWindowClient(openedClient);
    })(),
  );
});
