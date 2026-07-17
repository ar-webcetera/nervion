<script setup lang="ts">
import IconTimer from '~/components/Icons/IconTimer.vue';
import IconPlay from '~/components/Icons/IconPlay.vue';
import IconRestart from '~/components/Icons/IconRestart.vue';
import IconPause from '~/components/Icons/IconPause.vue';
import type { Timelog } from '~/types/task';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import IconButtonLoader from '~/components/Icons/IconButtonLoader.vue';
import IconSendTime from './Icons/IconSendTime.vue';
const timelogStore = useTimelogStore();
const taskStore = useTaskStore();
const { $toast } = useNuxtApp();

enum TIMELOG_STATUSES {
  in_progress = 'in_progress',
  paused = 'paused',
  completed = 'completed',
}

const props = defineProps<{
  timelog: Timelog | null;
  isRead?: boolean;
  task?: boolean;
}>();

const timelog = ref(props.timelog || null);

type BaseModalInstance = ComponentPublicInstance<{
  close(): void;
  open(): void;
}>;

const emit = defineEmits<{
  (e: 'create-timelog' | 'continue-timelog'): void;
  (e: 'reset-timelog', timelogId: number): void;
}>();

const restartTimerModal = ref<BaseModalInstance | null>(null);
const endModal = ref<BaseModalInstance | null>(null);
const summary = ref('');
const displaySeconds = ref(0);
const tickInterval = ref<ReturnType<typeof setInterval> | null>(null);
const pending = ref(false);

const onStart = async () => {
  try {
    if (!timelog.value) {
      emit('create-timelog');
      initFromTimelog();
    } else {
      emit('continue-timelog');
      const updatedTimelog = await timelogStore.updateTimelog(timelog.value.id, { status: TIMELOG_STATUSES.in_progress });
      timelog.value!.status = TIMELOG_STATUSES.in_progress;
      timelog.value!.time_spent = updatedTimelog.time_spent;
      timelog.value!.change_status_at = updatedTimelog.change_status_at;
      initFromTimelog();
    }
    startTick();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const sendTimelog = async (summary: string) => {
  try {
    if (isTracking.value) return;
    pending.value = true;
    stopTick();
    await timelogStore.updateTimelog(timelog.value!.id, { status: TIMELOG_STATUSES.completed, summary });
    taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((t) => t.id !== timelog.value!.task_id);
    timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== timelog.value!.id);
    emit('reset-timelog', timelog.value!.id);
    pending.value = false;
    endModal.value?.close();
    $toast('Таймлог успешно зафиксирован');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const deleteTimetrack = async () => {
  try {
    if (!timelog.value?.id) return;
    await timelogStore.deleteTimelog(timelog.value.id);
    emit('reset-timelog', timelog.value!.id);
    taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((t) => t.id !== timelog.value!.task_id);
    timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== timelog.value!.id);
    displaySeconds.value = 0;
    timelog.value = null;
    restartTimerModal.value?.close();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const onPause = async () => {
  try {
    if (!isTracking.value || !timelog.value) return;
    const updatedTimelog = await timelogStore.updateTimelog(timelog.value!.id, { status: TIMELOG_STATUSES.paused });
    timelog.value.status = TIMELOG_STATUSES.paused;
    timelog.value!.time_spent = updatedTimelog.time_spent;
    timelog.value!.change_status_at = updatedTimelog.change_status_at;
    stopTick();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const formatted = computed(() => {
  const sec = displaySeconds.value;
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
});

const startTick = () => {
  if (tickInterval.value) return;
  tickInterval.value = setInterval(() => displaySeconds.value++, 1000);
};
const stopTick = () => {
  if (tickInterval.value) {
    clearInterval(tickInterval.value);
    tickInterval.value = null;
  }
};

const initFromTimelog = () => {
  if (timelog.value?.status === TIMELOG_STATUSES.in_progress) {
    displaySeconds.value =
      Number(timelog.value.time_spent) + Math.floor((Date.now() - Number(timelog.value.change_status_at)) / 1000);
    startTick();
  }
  if (timelog.value?.status === TIMELOG_STATUSES.paused) {
    displaySeconds.value = Number(timelog.value.time_spent);
    stopTick();
  }
};

const isTracking = computed(() => {
  return timelog.value?.status === TIMELOG_STATUSES.in_progress;
});

onMounted(() => {
  initFromTimelog();
});
watch(
  () => timelog.value?.status,
  (newStatus, oldStatus) => {
    if (newStatus !== oldStatus) {
      initFromTimelog();
    }
  },
  { immediate: true },
);
watch(
  () => props.timelog,
  (val) => {
    const sameState =
      val?.id === timelog.value?.id &&
      val?.status === timelog.value?.status &&
      Number(val?.time_spent) === Number(timelog.value?.time_spent) &&
      Number(val?.change_status_at) === Number(timelog.value?.change_status_at);
    if (sameState) return;
    timelog.value = val ? { ...val } : null;
    initFromTimelog();
  },
  { deep: true },
);
onBeforeUnmount(() => {
  stopTick();
});
</script>

<template>
  <div :class="['timelog', { timelog_play: !timelog, timelog_task: task }]">
    <div v-if="displaySeconds && !isTracking && !isRead" class="timelog__send" @click="endModal!.open()"><IconSendTime /></div>
    <div class="timelog__block">
      <div v-if="!isTracking && !isRead" class="timelog__play" @click="onStart">
        <IconPlay />
      </div>
      <template v-if="timelog">
        <div v-if="isTracking && !isRead" class="timelog__pause" @click="onPause">
          <IconPause />
        </div>
        <div v-if="timelog?.time_spent" :class="['timelog__timer', { timelog__timer_running: isTracking }]">
          <ClientOnly>
            <span>{{ formatted }}</span>
          </ClientOnly>
          <IconRestart v-if="displaySeconds && !isTracking && !isRead" @click="restartTimerModal?.open()" />
          <IconTimer v-if="isTracking" />
        </div>
      </template>
    </div>
  </div>
  <teleport to="#teleports">
    <BaseModal ref="endModal">
      <div :class="['end-modal', { 'end-modal_pending': pending }]">
        <div class="end-modal__header">
          <div class="end-modal__icon"><IconSendTime /></div>
          <div class="end-modal__right">
            <h2>Что вы сделали за этот период?</h2>
            <span>Кратко опишите проделанную работу</span>
          </div>
        </div>
        <div class="end-modal__textarea">
          <textarea
            v-model="summary"
            placeholder="Например:
- Перенёс страницу “Профиль” на Nuxt 3 с Options API на Composition API
- Добавил динамический импорт компонента Avatar через defineAsyncComponent для снижения размера бандла"
          ></textarea>
        </div>
        <button @click="sendTimelog(summary)">
          <template v-if="!pending"> Зафиксировать </template>
          <template v-else> <IconButtonLoader class="btn__loader" /> </template>
        </button>
      </div>
    </BaseModal>
    <BaseModal ref="restartTimerModal">
      <div class="restart-timer-modal">
        <div class="restart-timer-modal__header">
          <h2>Сбросить таймер?</h2>
        </div>
        <button class="btn" @click="deleteTimetrack">Сбросить</button>
      </div>
    </BaseModal>
  </teleport>
</template>

<style scoped lang="scss">
.restart-timer-modal {
  padding: 24px;
  @include flex(cn);
  gap: 24px;

  &__header {
    h2 {
      @extend %h1;
    }
  }
}

.timelog {
  @include flex(rn, a-center);
  height: 32px;
  gap: 4px;
  margin: 0 8px;

  &_play,
  &_task {
    margin: 0;
  }

  &__block {
    @include flex(rn, a-center);
    gap: 4px;
    padding: 7px 8px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);
  }

  &__play,
  &__pause {
    display: flex;
    cursor: pointer;
  }
  &__timer {
    @include flex(rn, a-center);
    gap: 4px;
    @extend %p14-medium;
    color: var(--white-50);

    svg {
      cursor: pointer;

      &:last-child {
        stroke: var(--white-50);
      }
    }

    span {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary);
      display: flex;
    }

    &_running {
      svg {
        &:last-child {
          stroke: var(--status-in-progress);
        }
      }
    }
  }

  &__divider {
    height: 32px;
    width: 1px;
    background-color: var(--light-text-backgroung-primary-5);
  }
  &__send {
    width: 32px;
    height: 32px;
    @include flex(center);
    border-radius: 8px;
    background-color: var(--primary);
    cursor: pointer;
  }
}

:deep(.base-modal__content) {
  width: fit-content;
}

.end-modal {
  @include flex(cn, center);
  gap: 24px;
  width: 440px;

  &__header {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 0 24px;
  }

  &__icon {
    padding: 12px;
    @include flex(center);
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);

    svg {
      width: 24px;
      height: 24px;
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__right {
    @include flex(cn, j-center);
    gap: 4px;

    h2 {
      @extend %text-l-bold;
      color: var(--light-text-backgroung-primary);
      margin: 0;
    }

    span {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  & > div {
    width: 100%;
  }

  &__textarea {
    padding: 0 24px;
  }

  textarea {
    height: 192px;
    width: 100%;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background-color: unset;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &::placeholder {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  button {
    margin: 0 24px;
    padding: 10px 12px;
    width: -webkit-fill-available;
  }

  &_pending {
    & > div {
      filter: blur(2px);
    }
  }
}
</style>
