<script setup lang="ts">
import { ref, computed } from 'vue';
import TaskFormFields from '~/components/TaskForm/TaskFormFields.vue';
import IconLongBack from './Icons/IconLongBack.vue';

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
  <div class="task-sidebar" :style="sidebarStyle" @click.stop>
    <div class="task-sidebar__resize-handle" @mousedown="handleResizeStart"></div>
    <div class="task-sidebar__content">
      <div class="task-sidebar__close" @click="$emit('close')">
        <IconLongBack />
        <span>Задача</span>
      </div>
      <TaskFormFields @close="emit('close')" />
    </div>
  </div>
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
      padding: 24px 16px;
    }
  }

  &__close {
    display: none;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-mobile-l) {
      @include flex(rn, a-center);
      gap: 8px;
      padding: 4px 0 28px;
    }

    span {
      @extend %text-l-medium;
    }
  }
}
</style>
