import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useRootStore = defineStore('root', () => {
  const isHideSideBar = ref(false);
  // открыто полноэкранное «детальное» представление (письмо/композер) — на мобилке прячем нав-панель.
  // Синхронный флаг вместо route.query, чтобы панель не моргала (router.replace асинхронный).
  const isDetailFullscreen = ref(false);

  return {
    isHideSideBar,
    isDetailFullscreen,
  };
});
