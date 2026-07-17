import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useRootStore = defineStore('root', () => {
  const isHideSideBar = ref(false);
  const isDetailFullscreen = ref(false);

  return {
    isHideSideBar,
    isDetailFullscreen,
  };
});
