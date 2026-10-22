<script setup lang="ts">
import BaseMenuLeft from '~/components/BaseMenuLeft.vue';
import FloatingChatWidget from '~/components/Chat/FloatingChatWidget.vue';
import VoicePanel from '~/components/Voice/VoicePanel.vue';
import { PAGE_NAMES } from '~/constants/pages.constants';

const { refresh: refreshTaskStages } = useTaskStages();
await useAsyncData('task-stage-definitions', refreshTaskStages);

const taskStore = useTaskStore();
const rootStore = useRootStore();
const router = useRouter();
const route = useRoute();

const mobileReadyRouteNames = new Set<string>([
  PAGE_NAMES.home,
  PAGE_NAMES.CHAT,
  PAGE_NAMES.MAIL,
  PAGE_NAMES.report,
  PAGE_NAMES.AUDIT_LOGS,
  PAGE_NAMES.MAIL_ACCOUNTS,
  PAGE_NAMES.CALENDAR,
]);

const closeSidebar = () => {
  const { ['task-id']: _taskId, ['task-date']: _taskDate, ...query } = route.query;

  router.replace({ query });
  taskStore.currentTaskId = null;
  taskStore.currentTaskDate = null;
};

const isHidden = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : '';

  return !mobileReadyRouteNames.has(routeName) && !route.path.startsWith('/crm');
});

const chatId = computed(() => route.query?.chatId);
const mailDetailState = useState<boolean | null>('mail-detail-open', () => null);
const mailDetailOpen = computed(
  () => route.name === 'mail' && (mailDetailState.value ?? Boolean(route.query?.thread || route.query?.compose)),
);
</script>

<template>
  <div :class="['main', { main_hidden: isHidden, main_chat: chatId || mailDetailOpen || rootStore.isDetailFullscreen }]">
    <BaseMenuLeft :is-hidden-menu="isHidden" />
    <slot />
    <div v-if="isHidden" class="main__mob-error">
      <div class="main__mob-error-img"><img src="@/assets/blackhole.webp" alt="" /></div>
      <div class="main__mob-error-text">Нет мобильной версии</div>
      <div class="main__mob-error-desc">Мы всё еще работаем над мобильным приложением</div>
      <button class="main__mob-error-button" @click="router.push({ name: PAGE_NAMES.home })">Вернуться к задачам</button>
    </div>
  </div>
  <Transition name="task-panel">
    <div v-if="taskStore.currentTaskId" class="task-panel-host">
      <TaskSidebar :key="taskStore.currentTaskId" :current-task-id="taskStore.currentTaskId" @close="closeSidebar" />
    </div>
  </Transition>
  <ClientOnly>
    <FloatingChatWidget />
    <VoicePanel />
  </ClientOnly>
</template>

<style scoped lang="scss">
.main {
  height: 100%;
  min-height: 0;
  width: 100%;
  @include flex(rn);

  @media (max-width: $screen-mobile-l) {
    height: 100dvh;
    flex-direction: column;
    overflow: hidden;
  }

  & > * {
    &:nth-child(2) {
      @media (max-width: $screen-mobile-l) {
        flex: 1 1 0;
        width: 100%;
        height: auto;
        min-height: 0;
        overflow: auto;
      }
    }
  }

  &_hidden {
    & > * {
      &:nth-child(2) {
        @media (max-width: $screen-mobile-l) {
          display: none;
        }
      }
    }
  }

  &_chat {
    & > * {
      &:nth-child(2) {
        @media (max-width: $screen-mobile-l) {
          overflow: hidden;
        }
      }
    }
  }

  &__mob-error {
    display: none;

    @media (max-width: $screen-mobile-l) {
      @include flex(cn, center);
      width: 100%;
      height: 100%;
    }
  }

  &__mob-error-img {
    width: 321px;
    height: 207px;

    img {
      width: 100%;
      height: 100%;
    }
  }

  &__mob-error-text {
    margin-top: 12px;
    @extend %display-xs-medium;
  }

  &__mob-error-desc {
    margin-top: 4px;
    @extend %text-s-regular;
    width: 309px;
    text-align: center;
  }

  &__mob-error-button {
    margin-top: 40px;
  }

  &__content {
    width: 100%;
    height: 100dvh;
    padding: 16px;
    min-width: 0;
    flex: 1;
    @include flex(cn);
    gap: 4px;
  }
}

.task-panel-enter-active {
  transition: opacity 0.18s ease;

  :deep(.task-sidebar) {
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :deep(.task-sidebar__wrapper) {
    transition: opacity 0.18s ease;
  }
}

.task-panel-leave-active {
  transition: opacity 0.18s ease;

  :deep(.task-sidebar) {
    transition: transform 0.2s ease;
  }

  :deep(.task-sidebar__wrapper) {
    transition: opacity 0.18s ease;
  }
}

.task-panel-enter-from,
.task-panel-leave-to {
  opacity: 0;

  :deep(.task-sidebar) {
    transform: translateX(100%);
  }

  :deep(.task-sidebar__wrapper) {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-panel-enter-active,
  .task-panel-leave-active {
    transition: none;

    :deep(.task-sidebar),
    :deep(.task-sidebar__wrapper) {
      transition: none;
    }
  }
}
</style>
