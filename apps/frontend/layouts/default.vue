<script setup lang="ts">
import BaseMenuLeft from '~/components/BaseMenuLeft.vue';
import FloatingChatWidget from '~/components/Chat/FloatingChatWidget.vue';
import VoicePanel from '~/components/Voice/VoicePanel.vue';
import { PAGE_NAMES } from '~/constants/pages.constants';

const taskStore = useTaskStore();
const rootStore = useRootStore();
const router = useRouter();
const route = useRoute();

const closeSidebar = () => {
  const { ['task-id']: _taskId, ['task-date']: _taskDate, ...query } = route.query;

  router.replace({ query });
  taskStore.currentTaskId = null;
  taskStore.currentTaskDate = null;
};

const isHidden = computed(() => {
  return route.name !== 'home' && route.name !== 'chat' && route.name !== 'mail';
});

const chatId = computed(() => route.query?.chatId);
const mailDetailOpen = computed(
  () => route.name === 'mail' && Boolean(route.query?.thread || route.query?.compose),
);
</script>

<template>
  <div :class="['main', { main_hidden: isHidden, main_chat: chatId || mailDetailOpen || rootStore.isDetailFullscreen }]">
    <BaseMenuLeft :is-hidden-menu="isHidden" />
    <NuxtPage />
    <div v-if="isHidden" class="main__mob-error">
      <div class="main__mob-error-img"><img src="@/assets/blackhole.webp" alt="" /></div>
      <div class="main__mob-error-text">Нет мобильной версии</div>
      <div class="main__mob-error-desc">Мы всё еще работаем над мобильным приложением</div>
      <button class="main__mob-error-button" @click="router.push({ name: PAGE_NAMES.home })">Вернуться к задачам</button>
    </div>
  </div>
  <TaskSidebar v-if="taskStore.currentTaskId" :current-task-id="taskStore.currentTaskId" @close="closeSidebar" />
  <ClientOnly>
    <FloatingChatWidget />
    <VoicePanel />
  </ClientOnly>
</template>

<style scoped lang="scss">
.main {
  height: 100%;
  width: 100%;
  @include flex(rn);

  @media (max-width: $screen-mobile-l) {
    flex-direction: column;
    overflow: hidden;
  }

  & > * {
    &:nth-child(2) {
      @media (max-width: $screen-mobile-l) {
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
</style>
