import { ProjectRealtimeEvent } from '@tracker/contracts';
import { io, type Socket } from 'socket.io-client';
import { defineNuxtPlugin, useState } from '#app';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const tenantApiBaseUrl = usePublicApiBaseUrl();
  const apiBaseUrl = tenantApiBaseUrl || window.location.origin;
  const userStore = useUserStore();
  const tenantStore = useTenantStore();

  const webSocket: Socket = io(new URL('/ws', apiBaseUrl).toString(), {
    autoConnect: String(config.public.tenancyEnabled) !== 'true' || window.location.hostname !== config.public.platformAdminHost,
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
    auth: {
      user_id: userStore.user?.id,
    },
  });

  const projectStore = useProjectStore();
  const taskStore = useTaskStore();
  let projectRefreshPending = false;
  webSocket.on(ProjectRealtimeEvent.CHANGED, async () => {
    if (!userStore.user || !tenantStore.canUse('projects') || projectRefreshPending) return;
    projectRefreshPending = true;
    try {
      await projectStore.fetchProjects();
      taskStore.tasksPageHydrated = false;
      projectStore.revision++;
    } catch (error) {
      console.error('Не удалось обновить проекты', error);
    } finally {
      projectRefreshPending = false;
    }
  });

  const useWebSocket = useState<Socket>('webSocket', () => webSocket);

  return {
    provide: {
      webSocket,
      useWebSocket,
    },
  };
});
