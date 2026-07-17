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

  const useWebSocket = useState<Socket>('webSocket', () => webSocket);

  return {
    provide: {
      webSocket,
      useWebSocket,
    },
  };
});
