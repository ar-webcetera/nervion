<script setup lang="ts">
import { format } from 'date-fns';
import { X } from '@lucide/vue';
import { ru } from 'date-fns/locale';
import { computed, ref, watch } from 'vue';
import BaseModal from '~/components/BaseModal.vue';
import { useFormatTimeSpent } from '~/composables/useFormatTimeSpent';
import type { Timelog } from '~/types/task';
import { getErrorMessage } from '~/utils/error';
import IconTrash from './Icons/IconTrash.vue';

const timelogStore = useTimelogStore();
const { $toast } = useNuxtApp();

const props = defineProps<{
  taskId: number;
}>();

const pending = ref(true);

const deleteTimelogId = ref<number | null>(null);

const loadTimelogs = async (taskId: number) => {
  pending.value = true;

  try {
    await timelogStore.findTimelogsByTask(taskId);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pending.value = false;
  }
};

const isOpenReportTimeTrack = ref<boolean>(false);
const deleteTrackModal = ref<InstanceType<typeof BaseModal> | null>(null);
const selectedTimelog = ref<Timelog | null>(null);
const sortedTimelogs = computed(() =>
  [...timelogStore.timelogs].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
);

const capitalize = (value: string) => {
  if (!value) return value;
  const parts = value.split(' ');
  if (parts.length < 2 || !parts[1]) return value;
  parts[1] = `${parts[1][0].toUpperCase()}${parts[1].slice(1)}`;
  return parts.join(' ');
};

const openDeleteTrackModal = (timetrackId: number) => {
  if (!deleteTrackModal.value) return;
  deleteTimelogId.value = timetrackId;
  deleteTrackModal.value.open();
  const timelog = timelogStore.timelogs.find((c) => c.id === timetrackId);
  if (!timelog) return;
  selectedTimelog.value = timelog;
};

const closeDeleteTrackModal = () => {
  if (!deleteTrackModal.value) return;
  deleteTrackModal.value.close();
};

const openTaskTimeTrack = () => {
  isOpenReportTimeTrack.value = true;
  void loadTimelogs(props.taskId);
};

const closeTaskTimeTrack = () => {
  isOpenReportTimeTrack.value = false;
  deleteTimelogId.value = null;
};

const deleteTimelog = async (id: number | null) => {
  try {
    if (!id) return;
    await timelogStore.deleteTimelog(id);
    const index = timelogStore.timelogs.findIndex((c) => c.id === id);
    if (index !== -1) {
      timelogStore.timelogs.splice(index, 1);
    }
    deleteTimelogId.value = null;
    await loadTimelogs(props.taskId);
    closeDeleteTrackModal();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

watch(
  () => props.taskId,
  (taskId) => {
    selectedTimelog.value = null;
    deleteTimelogId.value = null;
    void loadTimelogs(taskId);
  },
  { immediate: true },
);

onUnmounted(() => {
  timelogStore.timelogs = [];
  timelogStore.totalTimeSpent = null;
});
</script>

<template>
  <div v-if="pending" class="loader__container">
    <div class="loader"></div>
  </div>
  <div v-else class="task-time-track__value" @click.stop="openTaskTimeTrack">
    {{ timelogStore.totalTimeSpent || 'Нет таймтреков' }}
  </div>

  <teleport to="#teleports">
    <div v-show="isOpenReportTimeTrack" class="task-time-track-dropdown__wrapper">
      <div v-click-outside="closeTaskTimeTrack" class="task-time-track-dropdown">
        <div class="task-time-track-dropdown__header">
          <h2>Отчёт по затраченному времени</h2>
          <button type="button" class="task-time-track-dropdown__close" aria-label="Закрыть отчёт" @click="closeTaskTimeTrack">
            <X :size="20" aria-hidden="true" />
          </button>
        </div>
        <div class="task-time-track-dropdown__table-wrapper">
          <div class="task-time-track-dropdown__table">
            <div class="task-time-track-dropdown__table-header">
              <div class="task-time-track-dropdown__table-date">Дата</div>
              <div class="task-time-track-dropdown__table-time">Затраченное время</div>
              <div class="task-time-track-dropdown__table-user">Пользователь</div>
              <div class="task-time-track-dropdown__table-comment">Комментарий</div>
              <div></div>
            </div>
            <div class="task-time-track-dropdown__table-body">
              <div v-for="timelog of sortedTimelogs" :key="timelog.id" class="task-time-track-dropdown-item">
                <div class="task-time-track-dropdown-item__date">
                  {{ capitalize(format(timelog.created_at, 'd MMM yyyy', { locale: ru })) }}
                </div>
                <div class="task-time-track-dropdown-item__time">{{ useFormatTimeSpent(timelog.time_spent) }}</div>
                <div class="task-time-track-dropdown-item__user">{{ useFullName(timelog.author) }}</div>
                <div class="task-time-track-dropdown-item__comment">
                  {{ timelog.summary }}
                </div>
                <div class="task-time-track-dropdown-item__delete" @click.stop="openDeleteTrackModal(timelog.id)">
                  <IconTrash />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <BaseModal ref="deleteTrackModal">
      <div class="delete-track-modal">
        <div class="delete-track-modal__header">
          <h2>Вы уверены что хотите удалить отчет?</h2>
          <span>
            Вы собираетесь удалить отчет
            {{ selectedTimelog ? `за ${format(selectedTimelog.created_at, 'dd MMMM yyyy', { locale: ru })}` : '' }} пользователя
            {{ selectedTimelog ? useFullName(selectedTimelog.author) : '' }}
          </span>
        </div>
        <div class="delete-track-modal__buttons">
          <button class="button_secondary" @click="closeDeleteTrackModal()">Отменить</button>
          <button class="btn" @click="deleteTimelog(selectedTimelog?.id || null)">Удалить</button>
        </div>
      </div>
    </BaseModal>
  </teleport>
</template>

<style scoped lang="scss">
.loader {
  margin-left: 10px;
  margin-top: 0;
  width: 16px;
  height: 16px;
  --b: 2px;
  border-radius: 50%;
  background: var(--primary-100);
  -webkit-mask:
    repeating-conic-gradient(#0000 0deg, #000 1deg 70deg, #0000 71deg 90deg),
    radial-gradient(farthest-side, #0000 calc(100% - var(--b) - 1px), #000 calc(100% - var(--b)));
  -webkit-mask-composite: destination-in;
  mask-composite: intersect;
  animation: l5 1s infinite;

  &__container {
    padding-top: 4px;
  }
}
.task-time-track {
  &__value {
    cursor: pointer;
  }
}

:deep(.base-modal__content) {
  width: fit-content;
}

.delete-track-modal {
  padding: 0 24px;
  @include flex(cn);
  gap: 48px;
  width: min(380px, calc(100vw - 34px));
  max-width: 100%;

  &__header {
    @include flex(cn);
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

  &__buttons {
    @include flex(rn);
    gap: 8px;

    button {
      flex: 1;
      padding: 10px 32px;
    }
  }
}

.task-time-track {
  &__value {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
}

.task-time-track-dropdown {
  border-radius: 8px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--dark-text-background-primary);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  position: relative;
  height: auto;
  width: 100%;
  max-width: 1248px;
  min-width: 0;
  max-height: calc(100dvh - 48px);

  @media (max-width: $screen-mobile-l) {
    border-radius: 0;
    border: none;
  }

  &__wrapper {
    @include flex(center);
    overflow: auto;
    padding: 24px;
    position: fixed;
    z-index: 1000;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);

    @media (max-width: $screen-mobile-l) {
      padding: 0;
    }
  }

  &__header {
    @include flex(rn, a-center, between);
    gap: 12px;
    flex-shrink: 0;
    h2 {
      margin: 0;
      @extend %text-l-medium;
    }
    padding: 16px 24px;
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__close {
    @include flex(center);
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    background: transparent;
    cursor: pointer;
    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
    &:focus-visible {
      outline: 2px solid var(--primary);
    }
  }

  &__table {
    border-radius: 8px;
    overflow: hidden;
    @include flex(cn);

    @media (max-width: $screen-mobile-l) {
      width: 100%;
      border-radius: 0;
    }
  }

  &__table-wrapper {
    min-height: 0;
    overflow-y: auto;
    padding: 16px 0;

    @media (max-width: $screen-mobile-l) {
      overflow: auto;
    }
  }

  &__table-body {
    height: 100%;
  }

  &__table-header {
    @include flex(rn);
    padding: 16px 24px;
    background: var(--light-text-backgroung-primary-10);

    & > div {
      @extend %text-s-medium;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__table-date {
    width: 180px;
  }

  &__table-time {
    width: 140px;
    margin-left: 64px;
  }

  &__table-user {
    width: 200px;
    margin-left: 64px;
  }

  &__table-comment {
    flex: 1;
    margin-left: 64px;
  }

  &__table-delete {
    width: 24px;
    margin-left: 16px;
  }
  @media (max-width: $screen-tablet) {
    &__header {
      padding: 12px 16px;
    }
    &__table-header {
      display: none;
    }
  }
}

.task-time-track-dropdown-item {
  @include flex(rn);
  border-top: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);
  padding: 16px 24px;

  & > div {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__date {
    width: 180px;
  }

  &__time {
    width: 140px;
    margin-left: 64px;
  }

  &__user {
    width: 200px;
    margin-left: 64px;
  }

  &__comment {
    flex: 1;
    margin-left: 64px;
  }

  &__delete {
    width: 24px;
    cursor: pointer;
    display: flex;

    svg {
      width: 24px;
      height: 24px;
    }
  }
  @media (max-width: $screen-tablet) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    gap: 8px 12px;
    padding: 16px;

    &__date,
    &__time,
    &__user,
    &__comment {
      width: auto;
      min-width: 0;
      margin: 0;
      grid-column: 1;
      overflow-wrap: anywhere;
    }
    &__date {
      grid-row: 1;
      color: var(--light-text-backgroung-primary-50);
    }
    &__time::before {
      content: 'Время: ';
      color: var(--light-text-backgroung-primary-50);
    }
    &__comment {
      white-space: pre-wrap;
    }
    &__delete {
      grid-column: 2;
      grid-row: 1 / 3;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
    }
  }
}
</style>
