import { ProjectRealtimeEvent } from '@tracker/contracts';
import { io, type Socket } from 'socket.io-client';
import { defineNuxtPlugin, useState } from '#app';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const apiBaseUrl = config.public.API_URL;
  const userStore = useUserStore();

  const webSocket: Socket = io(new URL('/ws', apiBaseUrl).toString(), {
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
    if (!userStore.user || projectRefreshPending) return;
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
