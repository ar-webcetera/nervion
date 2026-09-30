<script setup lang="ts">
import { ref, computed } from 'vue';
import { X } from '@lucide/vue';
import TaskFormFields from '~/components/TaskForm/TaskFormFields.vue';

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { resetForm } = useCreateTask();

const minWidth = 883;
const defaultWidth = 883;
const cookieName = 'sidebar-width';

const sidebarWidthCookie = useCookie<number>(cookieName, {
  maxAge: 365 * 24 * 60 * 60,
  path: '/',
});

const closeSidebar = () => {
  resetForm();
  emit('close');
};

const sidebarWidth = ref(
  sidebarWidthCookie.value && sidebarWidthCookie.value >= minWidth ? sidebarWidthCookie.value : defaultWidth,
);

const setSidebarWidthCookie = (width: number) => {
  sidebarWidth.value = width;
  sidebarWidthCookie.value = width;
};

const isResizing = ref(false);
const startX = ref(0);
const startWidth = ref(0);

const handleResizeStart = (e: MouseEvent) => {
  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = sidebarWidth.value;
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', handleResizeEnd);
};

const handleResizeMove = (e: MouseEvent) => {
  if (!isResizing.value) return;
  const delta = e.clientX - startX.value;
  const newWidth = Math.max(minWidth, startWidth.value - delta);
  setSidebarWidthCookie(newWidth);
};

const handleResizeEnd = () => {
  isResizing.value = false;
  setSidebarWidthCookie(sidebarWidth.value);
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
};

const sidebarStyle = computed(() => ({
  width: `${sidebarWidth.value}px`,
}));

onUnmounted(() => {
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
});
</script>

<template>
  <div class="task-sidebar__wrapper" @click="closeSidebar"></div>
  <aside class="task-sidebar" :style="sidebarStyle" @click.stop>
    <div class="task-sidebar__resize-handle" @mousedown="handleResizeStart"></div>
    <div class="task-sidebar__close">
      <span>Создание задачи</span>
      <button type="button" aria-label="Закрыть создание задачи" title="Закрыть" @click="closeSidebar">
        <X :size="20" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </div>
    <div class="task-sidebar__content">
      <TaskFormFields @close="emit('close')" />
    </div>
  </aside>
</template>

<style scoped lang="scss">
.task-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background-color: var(--dark-text-background-primary);
  box-shadow: -2px 0 8px var(--black-10);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-width: 100%;

  &__wrapper {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--black-50);
    z-index: 999;
  }

  &__resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--primary);
    }

    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__content {
    padding: 24px;
    flex: 1;
    overflow-y: auto;

    @media (max-width: $screen-mobile-l) {
      padding: 0 16px 24px;
    }
  }

  &__close {
    display: none;

    span {
      @extend %text-l-medium;
    }

    button {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      cursor: pointer;
      transition:
        background 0.15s,
        color 0.15s;
      @include flex(center);

      &:hover {
        background: var(--light-text-backgroung-primary-5);
        color: var(--light-text-backgroung-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }
    }

    @media (max-width: $screen-mobile-l) {
      min-height: 72px;
      padding: max(14px, env(safe-area-inset-top)) 12px 14px 16px;
      border-bottom: 1px solid var(--light-text-backgroung-primary-10);
      @include flex(rn, between, a-center);
    }
  }

  @media (max-width: $screen-mobile-l) {
    height: 100dvh;
  }
}
</style>
