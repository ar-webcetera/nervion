<script setup lang="ts">
import TaskComponent from '~/components/TaskComponent.vue';
import { PAGE_NAMES } from '~/constants/pages.constants';
import { TIMELOG_STATUSES } from '~/types/task';
import { computed } from 'vue';
import IconLongBack from './Icons/IconLongBack.vue';

const taskStore = useTaskStore();
const { $toast } = useNuxtApp();
const router = useRouter();
const timelogStore = useTimelogStore();
const userStore = useUserStore();
const isOpen = ref(false);

const isTimerRunning = computed(() => {
  return timelogStore.currentTimelogs.some((t) => t.status === TIMELOG_STATUSES.in_progress);
});

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const fetchTasks = async () => {
  try {
    return await taskStore.fetchTasksWithTimelogs();
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchCurrentTimelogs = async () => {
  try {
    const timelogs = await timelogStore.findByFilter({
      author_id: userStore.user!.id,
      status: [TIMELOG_STATUSES.in_progress, TIMELOG_STATUSES.paused],
    });
    timelogStore.currentTimelogs = timelogs ?? [];
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchData = async () => {
  try {
    if (!timelogStore.currentTimelogs.length) {
      await fetchCurrentTimelogs();
    }
    await fetchTasks();
  } catch (e) {
    console.log(e);
  }
};
const openTaskSidebar = (id: number) => {
  if (!id) return;
  router.push({
    name: PAGE_NAMES.home,
    query: { 'task-id': id },
  });
};

onMounted(() => {
  fetchData();
});
</script>

<template>
  <div :class="['base-top-tracker', { 'base-top-tracker_open': isOpen }]">
    <div class="cursor-pointer timer-icon-wrapper" :class="{ 'timer-running': isTimerRunning }" @click="toggle">
      <IconsIconTimer />
    </div>
    <div v-if="isOpen" class="tracker-modal">
      <div class="tracker-modal__header" @click="toggle">
        <p><IconLongBack />Тайм-трекер</p>
        <svg class="cursor-pointer" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div v-if="taskStore.tasksWithTimelogs.length" class="tracking-bar">
        <TaskComponent
          v-for="task of taskStore.tasksWithTimelogs"
          :key="task.id"
          :show-timetracking="true"
          class="task"
          :task="task"
          disable-dropdown
          @open-task-sidebar="openTaskSidebar"
        />
      </div>
      <div v-else class="empty-message">
        <img src="@/assets/empty_timer.webp" alt="" />
        <p>У вас нет активных таймеров</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.base-top-tracker {
  position: relative;

  svg {
    stroke: var(--light-text-backgroung-primary-50);
  }

  &_open {
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-10);

    svg {
      stroke: var(--light-text-backgroung-primary);
    }
  }
}

.timer-icon-wrapper {
  position: relative;
  @include flex();

  svg {
    width: 24px;
    height: 24px;
  }

  &.timer-running::after {
    content: '';
    position: absolute;
    top: 1px;
    right: 1px;
    width: 8px;
    height: 8px;
    background-color: var(--green);
    border-radius: 50%;
    border: 1.5px solid var(--dark-text-background-primary);
    animation: pulse 2s infinite;
  }
}

.empty-message {
  width: 100%;
  @include flex(cn, center);
  gap: 8px;
  padding: 24px;

  @media (max-width: $screen-mobile-l) {
    height: 100%;
  }

  img {
    width: 163px;
    height: auto;

    @media (max-width: $screen-mobile-l) {
      width: 260px;
    }
  }

  p {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    text-align: center;
    width: 138px;
  }
}

@keyframes pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 var(--green-50);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 5px transparent;
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 transparent;
  }
}

.tracker-modal {
  z-index: 3;
  min-width: 560px;
  top: 0;
  left: calc(100% + 24px);
  position: absolute;
  @include flex(cn);
  border-radius: 8px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--dark-text-background-primary);
  max-height: 400px;
  overflow-y: hidden;

  @media (max-width: $screen-mobile-l) {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    min-width: unset;
    max-height: unset;
    z-index: 1000;
    border-radius: 0;
    border: none;
  }

  &__header {
    width: 100%;
    padding: 16px 24px;
    @include flex(rn, a-center, between);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);

    @media (max-width: $screen-mobile-l) {
      padding: 28px 16px;
    }

    & > svg {
      width: 18px;
      height: 18px;

      @media (max-width: $screen-mobile-l) {
        display: none;
      }
    }

    p {
      @media (max-width: $screen-mobile-l) {
        @include flex(rn, center);
        gap: 12px;
      }

      svg {
        display: none;

        @media (max-width: $screen-mobile-l) {
          display: block;
        }
      }
    }
  }
}

.tracking-bar {
  padding: 16px 24px;
  width: 100%;
  @include flex(cn);
  overflow-y: auto;
  gap: 8px;
  margin: 4px 0 0;

  :deep(.task__drag) {
    display: none;
  }

  :deep(.task) {
    @media (max-width: $screen-mobile-l) {
      height: fit-content;
    }

    & > div {
      &:last-child {
        @media (max-width: $screen-mobile-l) {
          display: none;
        }
      }
    }
  }

  :deep(.task__track) {
    @media (max-width: $screen-mobile-l) {
      display: block;
    }

    .timelog {
      @media (max-width: $screen-mobile-l) {
        margin: 0;
      }
    }
  }

  // на мобилке боковые отступы списка = шапке (16px)
  @media (max-width: $screen-mobile-l) {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
