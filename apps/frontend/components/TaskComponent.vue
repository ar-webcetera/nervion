<script setup lang="ts">
import BaseModal from '~/components/BaseModal.vue';
import TaskCode from '~/components/TaskCode.vue';
import IconDrag from '~/components/Icons/IconDrag.vue';
import { TaskType, type Task, type Timelog } from '~/types/task';
import { useUserStore } from '~/stores/userStore';
import type { User } from '~/types/user';
import type { TASK_STATUSES } from '~/constants/task.constants';
import type { SelectOption } from '~/types/select';
import type { Project } from '~/types/project';
import { useProjectStore } from '~/stores/projectStore';
import IconUnlink from './Icons/IconUnlink.vue';

const updateStatusPending = ref(false);
const isUnlinkConfirmOpen = ref(false);
const confirmUnlink = async () => {
  if (await unlinkTask(props.task.id)) isUnlinkConfirmOpen.value = false;
};
const taskStore = useTaskStore();
const userStore = useUserStore();
const router = useRouter();
const route = useRoute();
const timelogStore = useTimelogStore();

const props = defineProps<{
  task: Task;
  stopTimer?: () => void;
  showTimetracking?: boolean;
  disableDropdown?: boolean;
  relatedTaskId?: number | null;
  /** Показывать в таймере иконку смены задачи */
  bindableTimelog?: boolean;
}>();

const emit = defineEmits<{
  (e: 'bind-task', timelog: Timelog): void;
}>();
const { $toast } = useNuxtApp();
const resposibleId = ref<number | null>(null);
const status = ref<string | null>(null);
const projectId = ref<number | null>(null);
const projectStore = useProjectStore();

resposibleId.value = props.task.responsible_id || null;
status.value = props.task.status || null;
projectId.value = props.task.project_id || null;

const allStatusOptions = useStatusOptions();
const statusOptions = computed(() =>
  props.task.business_kind === 'sales'
    ? allStatusOptions.value.filter((option) => ['to_do', 'in_progress', 'closed'].includes(option.value))
    : allStatusOptions.value,
);
const { deleteLinkLoader, unlinkTask } = useTaskLinks(ref(props.relatedTaskId || 0));

const usersOptions = computed(() => {
  if (userStore.users.length) {
    const users: SelectOption[] = userStore.users.map((user: User) => ({
      label: user.last_name + ' ' + user.first_name,
      value: user.id,
    }));
    return [...users];
  }
  return [];
});

const updateTaskProject = async (taskId: number, value: string | number | (string | number)[] | null) => {
  try {
    const project_id = Number(value);
    await taskStore.updateTask(taskId, { project_id });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const updateTaskStatus = async (taskId: number, value: string | number | (string | number)[] | null) => {
  try {
    const status = value as TASK_STATUSES;
    await taskStore.updateTask(taskId, { status });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const updateTaskResponsible = async (taskId: number, value: string | number | (string | number)[] | null) => {
  try {
    const responsible_id = Number(value);
    await taskStore.updateTask(taskId, { responsible_id });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const currentTaskId = computed<number | null>(() => {
  const q = route.query['task-id'];
  if (!q) return null;
  const val = Array.isArray(q) ? q[0] : q;
  const n = Number(val);
  return Number.isInteger(n) ? n : null;
});

const buildTaskSidebarQuery = (taskId: number, taskDate: string | null) => {
  const { ['task-id']: _currentTaskId, ['task-date']: _currentTaskDate, ...restQuery } = route.query;

  return taskDate
    ? {
        ...restQuery,
        'task-id': String(taskId),
        'task-date': taskDate,
      }
    : {
        ...restQuery,
        'task-id': String(taskId),
      };
};

const openTaskSidebar = (taskId: number) => {
  const taskDate = props.task.active_tracking_date ?? null;

  router.push({
    query: buildTaskSidebarQuery(taskId, taskDate),
  });
  taskStore.currentTaskId = taskId;
  taskStore.currentTaskDate = taskDate;
};
const projectOptions = computed(() => {
  if (projectStore.projects.length) {
    const projects: SelectOption[] = projectStore.projects.map((project: Project) => ({
      label: project.name,
      value: project.id,
    }));
    return projects;
  }
  return [];
});

const currentTimelog = computed(() => {
  if (!timelogStore.currentTimelogs.length) return null;
  return timelogStore.currentTimelogs.find((timelog) => props.task.id === timelog.task_id) || null;
});

onMounted(() => {
  taskStore.currentTaskId = currentTaskId.value;
});
</script>

<template>
  <div :class="['task', task.status, { task_related: relatedTaskId }]">
    <div class="task__drag task__drag-handle"><IconDrag /></div>
    <div class="task__info">
      <div class="task__name-wrapper">
        <div class="task__name" @click="openTaskSidebar(task.id)">
          <span v-if="task.taskType === TaskType.TASK" class="task__type-status task__type-status_task">
            <IconsIconTypeTask />
          </span>
          <span v-if="task.taskType === TaskType.USER_STORY" class="task__type-status task__type-status_story">
            <IconsIconTypeUserStory />
          </span>
          <span>{{ task.title }}</span>
        </div>
        <div class="task__header-actions">
          <TaskCode :id="task.id" />
          <button
            v-if="relatedTaskId"
            class="task__unlink-button"
            type="button"
            title="Отвязать задачу"
            aria-label="Отвязать задачу"
            :disabled="deleteLinkLoader[task.id]"
            @click.stop="isUnlinkConfirmOpen = true"
          >
            <span v-if="deleteLinkLoader[task.id]" class="loader loader_small"></span>
            <IconUnlink v-else />
          </button>
        </div>
        <div class="task__track">
          <BaseTimetrack
            v-if="showTimetracking && task.business_kind !== 'sales'"
            :timelog="currentTimelog"
            :bindable="bindableTimelog"
            @bind-task="emit('bind-task', $event)"
          />
        </div>
      </div>
      <div class="task__tags">
        <div v-if="updateStatusPending" class="loader loader_small"></div>
        <div class="task__tag">
          <BaseDropdown
            :model-value="task.status"
            :options="statusOptions"
            placeholder="Статус не указан"
            :disabled="disableDropdown"
            @update:model-value="updateTaskStatus(task.id, $event)"
          />
        </div>
        <div class="task__tag">
          <BaseDropdown
            v-model="projectId"
            :options="projectOptions"
            placeholder="Проект не указан"
            :disabled="disableDropdown"
            @update:model-value="updateTaskProject(task.id, $event)"
          />
        </div>
        <div class="task__tag">
          <BaseDropdown
            v-model="resposibleId"
            :options="usersOptions"
            placeholder="Ответственный не указан"
            :disabled="disableDropdown"
            @update:model-value="updateTaskResponsible(task.id, $event)"
          />
        </div>
      </div>
    </div>

    <BaseTimetrack
      v-if="showTimetracking && task.business_kind !== 'sales'"
      :timelog="currentTimelog"
      :bindable="bindableTimelog"
      @bind-task="emit('bind-task', $event)"
    />
    <Teleport to="body">
      <BaseModal v-model="isUnlinkConfirmOpen" :dismissible="!deleteLinkLoader[task.id]">
        <div
          class="task-unlink-confirm"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`unlink-title-${task.id}`"
          @keydown.esc="!deleteLinkLoader[task.id] && (isUnlinkConfirmOpen = false)"
        >
          <h2 :id="`unlink-title-${task.id}`">Отвязать задачу?</h2>
          <p>Убрать связь с «{{ task.title }}» (NRV-{{ task.id }})? Сама задача останется.</p>
          <div class="task-unlink-confirm__actions">
            <button class="button_secondary" :disabled="deleteLinkLoader[task.id]" @click="isUnlinkConfirmOpen = false">
              Отмена
            </button>
            <button class="button_primary" :disabled="deleteLinkLoader[task.id]" @click="confirmUnlink">
              {{ deleteLinkLoader[task.id] ? 'Отвязываем…' : 'Отвязать' }}
            </button>
          </div>
        </div>
      </BaseModal>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.task-unlink-confirm {
  @include flex(cn);
  gap: 16px;
  width: min(400px, calc(100vw - 64px));
  padding: 0 24px 24px;
  color: var(--light-text-backgroung-primary);
  h2 {
    @extend %text-xl-medium;
    margin: 0;
  }
  p {
    @extend %text-s-regular;
    margin: 0;
    overflow-wrap: anywhere;
  }
  &__actions {
    @include flex(rn, j-end);
    gap: 8px;
  }
}

.restart-timer-modal {
  padding: 24px;
  @include flex(cn);
  gap: 24px;
}

.loader-small {
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

  &__wrapper {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
}

.task {
  @include flex(rn, a-center);
  min-height: 56px;
  height: auto;
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);

  @media (max-width: $screen-mobile-l) {
    height: auto;
    align-items: unset;
  }

  &.closed {
    opacity: 0.4;

    .task__name {
      text-decoration: line-through;
    }
  }

  &_related {
    align-items: flex-start;

    .task__tags {
      flex-wrap: wrap;
      gap: 4px 12px;
    }

    .task__name span:last-child {
      -webkit-line-clamp: 2;
      overflow-wrap: anywhere;
    }
  }

  &__drag {
    display: flex;
    align-items: center;
    padding: 8px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__drag-handle {
    cursor: grab;
    height: 100%;

    @media (max-width: $screen-mobile-l) {
      height: auto;
    }
  }

  &__info {
    min-width: 0;
    @include flex(cn);
    gap: 4px;
    padding: 8px;
    flex: 1;
  }

  &__tags {
    @include flex(rn, a-center);
    gap: 12px;

    @media (max-width: $screen-mobile-l) {
      flex-wrap: wrap;
      row-gap: 4px;
    }
  }

  &__tag {
    cursor: pointer;
    @include flex(center);
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
    gap: 4px;

    &:hover {
      color: var(--white-100);
    }

    span {
      color: var(--white-100);
    }

    svg {
      margin-top: 2px;
      width: 14px;
      transform: rotate(90deg);
    }
  }

  &__assignee {
    @extend %p12-medium;
    color: var(--white-50);

    span {
      color: var(--white-100);
    }
  }

  &__header-actions {
    @include flex(rn, a-center);
    flex-shrink: 0;
    gap: 4px;
  }

  &__unlink-button {
    @include flex(center);
    width: 28px;
    height: 28px;
    padding: 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;

    svg {
      width: 16px;
      height: 16px;
    }

    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    &:disabled {
      cursor: wait;
      opacity: 0.5;
    }

    @media (pointer: coarse) {
      width: 44px;
      height: 44px;
    }
  }

  &__name-wrapper {
    min-width: 0;
    gap: 8px;
    @include flex(rn, a-center, between);
  }

  &__name {
    min-width: 0;
    flex: 1;
    cursor: pointer;
    @include flex(rn, a-center);
    gap: 4px;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);

    span {
      &:last-child {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }

  &__track {
    display: none;
  }

  &__type-status {
    @include flex(center);
    width: 20px;
    height: 20px;
    border-radius: 4px;

    &_task {
      border: 1px solid var(--primary);
      background: var(--primary-50);
    }

    &_story {
      border: 1px solid var(--accent);
      background: var(--accent-50);
    }
  }

  &__options {
    @include flex(rn, a-center);
    gap: 18px;
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
      width: 60px;
    }

    &_running {
      color: var(--white-100);

      svg {
        &:last-child {
          stroke: var(--white-100);
        }
      }
    }
  }

  &__divider {
    height: 32px;
    width: 1px;
    background-color: var(--light-text-backgroung-primary-5);
  }

  &__play,
  &__pause {
    display: flex;
    cursor: pointer;
  }

  &__send {
    width: 32px;
    height: 32px;
    @include flex(center);
    border-radius: 8px;
    background-color: var(--primary-100);
    cursor: pointer;
  }

  &__unlink-task {
    @include flex(center);
    cursor: pointer;
    padding-right: 8px;
  }
}
</style>
