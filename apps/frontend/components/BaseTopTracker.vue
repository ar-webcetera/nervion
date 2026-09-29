<script setup lang="ts">
import { Plus, Timer, TimerOff, X } from '@lucide/vue';
import TaskComponent from '~/components/TaskComponent.vue';
import BaseModal from '~/components/BaseModal.vue';
import BaseTimetrack from '~/components/BaseTimetrack.vue';
import { PAGE_NAMES } from '~/constants/pages.constants';
import { TIMELOG_STATUSES, type Timelog, type Task } from '~/types/task';
import { UNBOUND_TIMELOG_TITLE } from '@tracker/contracts';
import { computed, ref } from 'vue';
import { getErrorMessage } from '~/utils/error';

const taskStore = useTaskStore();
const { $toast } = useNuxtApp();
const router = useRouter();
const timelogStore = useTimelogStore();
const userStore = useUserStore();
const isOpen = ref(false);

const isTimerRunning = computed(() => {
  return timelogStore.currentTimelogs.some((t) => t.status === TIMELOG_STATUSES.in_progress);
});

const unboundTimelogs = computed(() => timelogStore.currentTimelogs.filter((t) => t.task_id === null || t.task_id === undefined));

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const open = () => {
  isOpen.value = true;
};

const close = () => {
  isOpen.value = false;
};

defineExpose({ open, close });

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

type ModalRef = ComponentPublicInstance<{ open(): void; close(): void }> | null;

const newTimerModal = ref<ModalRef>(null);
const attachModal = ref<ModalRef>(null);

const newTimerTitle = ref('');
const newTimerPending = ref(false);

const openNewTimerModal = () => {
  newTimerTitle.value = '';
  newTimerModal.value?.open();
};

const createUnboundTimelog = async () => {
  if (newTimerPending.value) return;
  newTimerPending.value = true;
  try {
    const raw = newTimerTitle.value.trim();
    const created = await timelogStore.createTimelog({
      author_id: userStore.user!.id,
      status: TIMELOG_STATUSES.in_progress,
      ...(raw ? { title: raw } : {}),
    } as Partial<Timelog>);
    if (created) timelogStore.upsertCurrentTimelog(created, true);
    newTimerModal.value?.close();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    newTimerPending.value = false;
  }
};

const editingTitleId = ref<number | null>(null);
const editingTitleValue = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

const startEditTitle = async (t: Timelog) => {
  editingTitleId.value = t.id;
  editingTitleValue.value = t.title ?? '';
  await nextTick();
  titleInput.value?.focus();
  titleInput.value?.select();
};

const saveTitle = async (t: Timelog) => {
  if (editingTitleId.value !== t.id) return;
  const value = editingTitleValue.value.trim();
  editingTitleId.value = null;
  if ((t.title ?? '') === value) return;
  try {
    const updated = await timelogStore.updateTimelog(t.id, { title: value });
    const idx = timelogStore.currentTimelogs.findIndex((x) => x.id === t.id);
    if (idx !== -1) timelogStore.currentTimelogs[idx] = { ...timelogStore.currentTimelogs[idx], ...updated };
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const attachTargetId = ref<number | null>(null);
const attachSearch = ref('');
const attachResults = ref<Task[]>([]);
const attachPending = ref(false);
/** Задача, к которой таймер привязан сейчас: если есть, показываем подтверждение переноса */
const attachCurrentTask = ref<Task | null>(null);
const attachConfirmTask = ref<Task | null>(null);

const attachModalTitle = computed(() => (attachCurrentTask.value ? 'Сменить задачу' : 'Привязать к задаче'));

const attachTargetSpent = computed(() => {
  const timelog = timelogStore.currentTimelogs.find((t) => t.id === attachTargetId.value);
  if (!timelog) return '00:00:00';
  const base = Number(timelog.time_spent);
  const extra =
    timelog.status === TIMELOG_STATUSES.in_progress ? Math.floor((Date.now() - Number(timelog.change_status_at)) / 1000) : 0;
  return useFormatTimeSpent(base + extra);
});

const openAttachModal = (timelogId: number, currentTask: Task | null = null) => {
  attachTargetId.value = timelogId;
  attachCurrentTask.value = currentTask;
  attachConfirmTask.value = null;
  attachSearch.value = '';
  attachResults.value = [];
  attachModal.value?.open();
};

/** У привязанной задачи в панели всегда есть активный таймлог текущего пользователя */
const openChangeTaskModal = (task: Task) => {
  const timelog = timelogStore.currentTimelogs.find((t) => t.task_id === task.id);
  if (!timelog) return;
  openAttachModal(timelog.id, task);
};

let attachSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let attachSearchSeq = 0;

const runAttachSearch = () => {
  if (attachSearchDebounce) clearTimeout(attachSearchDebounce);
  attachSearchDebounce = setTimeout(() => {
    const seq = ++attachSearchSeq;
    const title = attachSearch.value.trim();
    if (!title) {
      attachResults.value = [];
      return;
    }
    taskStore
      .searchTasks(title)
      .then((tasks) => {
        if (seq !== attachSearchSeq) return;
        attachResults.value = tasks;
      })
      .catch((e) => $toast.error(getErrorMessage(e)));
  }, 250);
};

const pickAttachTask = (task: Task) => {
  if (attachCurrentTask.value && attachCurrentTask.value.id !== task.id) {
    attachConfirmTask.value = task;
    return;
  }
  void applyAttach(task);
};

const applyAttach = async (task: Task) => {
  if (!attachTargetId.value || attachPending.value) return;
  attachPending.value = true;
  const wasBound = Boolean(attachCurrentTask.value);
  try {
    await timelogStore.updateTimelog(attachTargetId.value, { task_id: task.id });
    timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== attachTargetId.value);
    await fetchTasks();
    attachModal.value?.close();
    attachConfirmTask.value = null;
    $toast(wasBound ? 'Таймер перенесён на другую задачу' : 'Таймер привязан к задаче');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    attachPending.value = false;
  }
};

const onUnboundReset = (id: number) => {
  timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== id);
};

onBeforeUnmount(() => {
  if (attachSearchDebounce) clearTimeout(attachSearchDebounce);
});
</script>

<template>
  <div :class="['base-top-tracker', { 'base-top-tracker_open': isOpen }]">
    <button
      type="button"
      class="timer-icon-wrapper"
      :class="{ 'timer-running': isTimerRunning }"
      aria-label="Тайм-трекер"
      title="Тайм-трекер"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <Timer :size="20" :stroke-width="1.75" aria-hidden="true" />
    </button>
    <div v-if="isOpen" class="tracker-modal">
      <div class="tracker-modal__header">
        <h2>Тайм-трекер</h2>
        <div class="tracker-modal__header-actions">
          <button type="button" class="tracker-modal__new" @click="openNewTimerModal">
            <Plus :size="16" :stroke-width="1.75" aria-hidden="true" />
            <span>Новый таймер</span>
          </button>
          <button
            type="button"
            class="tracker-modal__close"
            aria-label="Закрыть тайм-трекер"
            title="Закрыть"
            @click="toggle"
          >
            <X :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div v-if="unboundTimelogs.length || taskStore.tasksWithTimelogs.length" class="tracking-bar">
        <div v-for="t of unboundTimelogs" :key="`unbound-${t.id}`" class="unbound-row">
          <div class="unbound-row__title">
            <template v-if="editingTitleId === t.id">
              <input
                ref="titleInput"
                v-model="editingTitleValue"
                class="unbound-row__title-input"
                maxlength="120"
                @keydown.enter.prevent="saveTitle(t)"
                @keydown.esc.prevent="editingTitleId = null"
                @blur="saveTitle(t)"
              />
            </template>
            <template v-else>
              <span class="unbound-row__title-text" :title="t.title || UNBOUND_TIMELOG_TITLE" @click="startEditTitle(t)">
                {{ t.title || UNBOUND_TIMELOG_TITLE }}
              </span>
              <span class="unbound-row__badge">не привязан</span>
            </template>
          </div>
          <div class="unbound-row__right">
            <BaseTimetrack :timelog="t" bindable @reset-timelog="onUnboundReset" @bind-task="openAttachModal(t.id)" />
          </div>
        </div>

        <TaskComponent
          v-for="task of taskStore.tasksWithTimelogs"
          :key="task.id"
          :show-timetracking="true"
          class="task"
          :task="task"
          disable-dropdown
          bindable-timelog
          @open-task-sidebar="openTaskSidebar"
          @bind-task="openChangeTaskModal(task)"
        />
      </div>
      <div v-else class="empty-message" role="status">
        <TimerOff :size="28" :stroke-width="1.75" aria-hidden="true" />
        <strong>Активных таймеров пока нет</strong>
        <p>Запустите новый таймер или включите учёт времени в задаче.</p>
      </div>
    </div>

    <teleport to="#teleports">
      <BaseModal ref="newTimerModal">
        <div class="new-timer-modal">
          <h2>Новый таймер</h2>
          <p class="new-timer-modal__hint">Название необязательно. Если оставить пустым, будет "{{ UNBOUND_TIMELOG_TITLE }}".</p>
          <input
            v-model="newTimerTitle"
            type="text"
            placeholder="Например: разбор почты"
            class="new-timer-modal__input"
            maxlength="120"
            @keydown.enter.prevent="createUnboundTimelog"
          />
          <button type="button" :disabled="newTimerPending" @click="createUnboundTimelog">Запустить</button>
        </div>
      </BaseModal>

      <BaseModal ref="attachModal">
        <div class="attach-modal">
          <h2>{{ attachModalTitle }}</h2>

          <template v-if="attachConfirmTask">
            <p class="attach-modal__confirm">
              Перенести {{ attachTargetSpent }} с задачи "{{ attachCurrentTask?.title }}" на "{{ attachConfirmTask.title }}"?
            </p>
            <div class="attach-modal__confirm-actions">
              <button type="button" class="attach-modal__cancel" :disabled="attachPending" @click="attachConfirmTask = null">
                Отмена
              </button>
              <button
                type="button"
                class="attach-modal__submit"
                :disabled="attachPending"
                @click="applyAttach(attachConfirmTask)"
              >
                Перенести
              </button>
            </div>
          </template>

          <template v-else>
            <input
              v-model="attachSearch"
              type="text"
              placeholder="Поиск задачи по названию"
              class="attach-modal__search"
              @input="runAttachSearch"
            />
            <div class="attach-modal__list">
              <div v-if="!attachResults.length" class="attach-modal__empty">
                {{ attachSearch ? 'Ничего не найдено' : 'Начните вводить название задачи' }}
              </div>
              <button
                v-for="task of attachResults"
                :key="task.id"
                type="button"
                class="attach-modal__item"
                :disabled="attachPending || task.id === attachCurrentTask?.id"
                @click="pickAttachTask(task)"
              >
                <span class="attach-modal__item-title">{{ task.title }}</span>
                <span v-if="task.projectName" class="attach-modal__item-project">{{ task.projectName }}</span>
              </button>
            </div>
          </template>
        </div>
      </BaseModal>
    </teleport>
  </div>
</template>

<style scoped lang="scss">
.base-top-tracker {
  position: relative;

  > .timer-icon-wrapper {
    color: var(--light-text-backgroung-primary-50);
  }

  &_open {
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-10);

    > .timer-icon-wrapper {
      color: var(--light-text-backgroung-primary);
    }
  }
}

.timer-icon-wrapper {
  position: relative;
  @include flex(center);
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--light-text-backgroung-primary);
    background: var(--light-text-backgroung-primary-5);
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  &:active {
    background: var(--light-text-backgroung-primary-25);
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

  @media (prefers-reduced-motion: reduce) {
    &.timer-running::after {
      animation: none;
    }
  }
}

.empty-message {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: auto;
  max-width: 280px;
  margin: auto;
  @include flex(cn, center);
  gap: 8px;
  padding: 24px 0;
  color: var(--light-text-backgroung-primary-50);
  text-align: center;

  svg {
    margin-bottom: 4px;
    color: var(--light-text-backgroung-primary-25);
  }

  strong {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  p {
    margin: 0;
    @extend %text-xs-regular;
  }

  @media (max-width: $screen-mobile-l) {
    padding: 24px 16px max(24px, env(safe-area-inset-bottom));
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
  // Фиксируем ширину: иначе длинное название таймера растягивает панель
  width: 560px;
  max-width: calc(100vw - 120px);
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
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100dvh;
    min-height: 100dvh;
    min-width: unset;
    max-height: 100dvh;
    z-index: 1000;
    border-radius: 0;
    border: none;
  }

  &__header {
    flex: 0 0 auto;
    width: 100%;
    padding: 16px 24px;
    @include flex(rn, a-center, between);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);

    h2 {
      min-width: 0;
      margin: 0;
      @extend %text-l-medium;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: $screen-mobile-l) {
      min-height: 72px;
      padding: max(14px, env(safe-area-inset-top)) 12px 14px 16px;
    }
  }

  &__header-actions {
    @include flex(rn, a-center);
    flex: 0 0 auto;
    gap: 4px;
  }

  &__new {
    min-height: 36px;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-xs-regular;
    @include flex(rn, a-center);
    gap: 6px;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    @media (max-width: $screen-mobile-l) {
      min-height: 44px;
    }

    @media (max-width: 359px) {
      width: 44px;
      height: 44px;
      padding: 0;
      justify-content: center;

      span {
        display: none;
      }
    }
  }

  &__close {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @include flex(center);

    &:hover,
    &:focus-visible {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }
}

.unbound-row {
  @include flex(rn, a-center, between);
  gap: 12px;
  min-height: 56px;
  min-width: 0;
  // Справа отступ даёт собственный margin блока таймера, как в строке задачи
  padding: 8px 0 8px 16px;
  border-radius: 8px;
  border: 1px dashed var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);

  &__title {
    @include flex(rn, a-center);
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  &__title-text {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    cursor: text;
    // min-width нужен, чтобы flex-элемент сжимался и включался ellipsis
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__title-input {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    background: transparent;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 4px;
    padding: 2px 6px;
    flex: 1;
    min-width: 0;
  }

  &__badge {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--light-text-backgroung-primary-10);
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__right {
    @include flex(rn, a-center);
    gap: 8px;
    flex-shrink: 0;
  }

  @media (max-width: $screen-mobile-l) {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    padding: 12px;

    &__title {
      width: 100%;
    }

    &__right {
      justify-content: flex-end;
      width: 100%;
    }
  }
}

.new-timer-modal {
  @include flex(cn);
  gap: 16px;
  // Вертикальные отступы уже задаёт .base-modal__content
  padding: 0 24px;
  width: 100%;

  h2 {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
    margin: 0;
  }

  &__hint {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    margin: 0;
  }

  &__input {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }

  button {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--dark-text-background-primary);
    border: none;
    cursor: pointer;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
}

.attach-modal {
  @include flex(cn);
  gap: 12px;
  padding: 0 24px;
  width: 100%;

  h2 {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
    margin: 0;
  }

  &__search {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }

  &__list {
    @include flex(cn);
    gap: 4px;
    max-height: 320px;
    overflow-y: auto;
  }

  &__empty {
    padding: 12px;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__item {
    // Глобальный стиль button центрирует содержимое и запрещает перенос
    @include flex(cn, a-start);
    gap: 2px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__item-title {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__item-project {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__confirm {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    margin: 0;
  }

  &__confirm-actions {
    @include flex(rn, a-center);
    gap: 8px;

    button {
      flex: 1;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
  }

  &__cancel {
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
  }

  &__submit {
    border: none;
    background: var(--primary);
    color: var(--dark-text-background-primary);
  }
}

.tracking-bar {
  flex: 1 1 auto;
  min-height: 0;
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

  @media (max-width: $screen-mobile-l) {
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
    margin-top: 0;

    :deep(.task__name-wrapper) {
      align-items: flex-start;
    }

    :deep(.task__track) {
      flex: 0 0 auto;
    }
  }
}
</style>
