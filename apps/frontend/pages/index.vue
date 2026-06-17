<script setup lang="ts">
import type { FilterChip } from '~/types/filter';
import { FilterType } from '~/types/filter';
import BaseSelect from '~/components/BaseSelect.vue';
import TaskComponent from '~/components/TaskComponent.vue';
import CreateTaskSidebar from '~/components/CreateTaskSidebar.vue';
import { TASK_STATUSES, TaskType } from '~/types/task';
import type { SelectOption } from '~/types/select';
import type { User } from '~/types/user';
import type { Project } from '~/types/project';
import { useProjectStore } from '~/stores/projectStore';
import type { Task } from '~/types/task';
import type { JSONContent } from '@tiptap/core';
import IconButtonLoader from '~/components/Icons/IconButtonLoader.vue';
import { TASK_STATUS_LABELS, MAX_TASK_NAME_LENGTH } from '~/constants/task.constants';
import { format } from 'date-fns';
const projectStore = useProjectStore();
const { $toast } = useNuxtApp();
const taskStore = useTaskStore();
const createTaskPending = ref(false);
const isOpenTaskCreateModal = ref(false);
const userStore = useUserStore();
const route = useRoute();
const router = useRouter();

const { kanban } = storeToRefs(taskStore);
const { getKanban } = taskStore;

const onKanbanLoadMore = async ({ status, offset, done }: { status: string; offset: number; done?: () => void }) => {
  try {
    await taskStore.loadMoreColumn(status, { useSavedFilters: true }, offset);
  } finally {
    done?.();
  }
};

const draggedIndex = ref<number | null>(null);
const targetIndex = ref<number | null>(null);

const isDisabledCreateTaskButton = computed(() => {
  return !newTask.value.title;
});

enum ViewType {
  KANBAN = 'kanban',
  LIST = 'list',
  WEEKLY = 'weekly',
}
// Режим отображения хранится per-user в БД (приходит на SSR через getFilterState) — без моргания.
const viewType = computed<ViewType>(() => (taskStore.viewType as ViewType) ?? ViewType.LIST);

const onToggleCollapse = (payload: { status: TASK_STATUSES; collapsed: boolean }) => {
  taskStore.setColumnCollapsed(payload.status, payload.collapsed);
};

const fetchTasks = async () => {
  try {
    await taskStore.fetchTasks({ useSavedFilters: true });
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchKanban = async () => {
  try {
    await getKanban({ useSavedFilters: true });
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchWeekly = async () => {
  try {
    await taskStore.refreshWeeklyTasks();
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

interface NewTask {
  title: string;
  project_id: number | null;
  responsible_id: number | null;
  status: TASK_STATUSES;
  description: JSONContent;
}
const initialTaskData = {
  title: '',
  project_id: null,
  responsible_id: null,
  status: TASK_STATUSES.open,
  description: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '' }],
      },
    ],
  },
};
const newTask = ref<NewTask>({
  title: '',
  project_id: null,
  responsible_id: null,
  status: TASK_STATUSES.open,
  description: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '' }],
      },
    ],
  },
});

const createTask = async () => {
  try {
    createTaskPending.value = true;
    const project_id = Number(route.params.id);

    const taskObject: Partial<Task> = {
      title: newTask.value.title,
      project_id,
    };
    if (newTask.value.status) taskObject.status = newTask.value.status;
    if (newTask.value.project_id) taskObject.project_id = newTask.value.project_id;
    if (newTask.value.responsible_id) taskObject.responsible_id = newTask.value.responsible_id;
    if (newTask.value.description) taskObject.description = newTask.value.description;

    const createdTask = await taskStore.createTask(taskObject);
    isOpenTaskCreateModal.value = false;
    newTask.value = initialTaskData;
    openTaskSidebar(createdTask.id);
    $toast('Задача успешно создана');
  } catch (e) {
    console.log(e);
    $toast.error('Ошибка при создании задачи');
  } finally {
    createTaskPending.value = false;
  }
};

const statusOptions = useStatusOptions();

const usersOptions = computed(() => {
  if (userStore.users.length) {
    const users: SelectOption[] = userStore.users.map((user: User) => ({
      label: user.last_name + ' ' + user.first_name,
      value: user.id,
    }));

    if (userStore.user) {
      const currentIndex = users.findIndex((user) => user.value === userStore.user?.id);
      if (currentIndex > -1) {
        const [currentUser] = users.splice(currentIndex, 1);
        users.unshift(currentUser);
      }
    }
    return users;
  }
  return [];
});

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

const stopTimer = (): void => {
  if (!taskStore.timer) return;
  clearInterval(taskStore.timer);
  for (const task of taskStore.tasks) {
    if (task.isTimerRunning) {
      task.isTimerRunning = false;
      break;
    }
  }
  taskStore.timer = null;
  taskStore.accumulatedTime = 0;
  localStorage.setItem('trackerData', JSON.stringify(taskStore.tasks));
};
const onDragStart = (index: number) => {
  draggedIndex.value = index;
};

const onDragEnter = (index: number) => {
  targetIndex.value = index;
};
const onDragEnd = async () => {
  const from = draggedIndex.value;
  const to = targetIndex.value;

  if (from === null || to === null || from === to) {
    draggedIndex.value = targetIndex.value = null;
    return;
  }

  const list = taskStore.tasks;

  const idFrom = list[from].id;
  const idTo = list[to].id;

  const temp = list[from];
  list[from] = list[to];
  list[to] = temp;

  try {
    await taskStore.swapPriorityTask([idFrom, idTo]);
  } catch {
    $toast.error('Не удалось сохранить порядок задач');
    const temp2 = list[from];
    list[from] = list[to];
    list[to] = temp2;
  }

  draggedIndex.value = targetIndex.value = null;
};

const setViewType = (type: ViewType) => {
  taskStore.saveViewType(type);
  if (type === ViewType.KANBAN) {
    fetchKanban();
  }
  if (type === ViewType.LIST) {
    fetchTasks();
  }
  if (type === ViewType.WEEKLY) {
    fetchWeekly();
  }
};

const openTaskSidebar = (taskId: number) => {
  router.push({
    query: { 'task-id': taskId },
  });
  taskStore.currentTaskId = taskId;
};

const isCreateTaskSidebarOpen = ref(false);
const filterPanelRef = ref<{ clearSearch: () => void } | null>(null);

const openCreateTaskSidebar = () => {
  isCreateTaskSidebarOpen.value = true;
};

const closeCreateTaskSidebar = () => {
  isCreateTaskSidebarOpen.value = false;
};

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const handleSearch = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const searchText = target.value.trim();

  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(async () => {
    taskStore.filter.title = searchText || undefined;
    await taskStore.saveFilterState();

    if (viewType.value === ViewType.LIST) fetchTasks();
    if (viewType.value === ViewType.KANBAN) fetchKanban();
    if (viewType.value === ViewType.WEEKLY) fetchWeekly();
  }, 500);
};

const isExporting = ref(false);

const handleExport = async () => {
  if (isExporting.value) return;

  try {
    isExporting.value = true;
    await taskStore.exportTasks({ useSavedFilters: true });
    $toast.success('Файл успешно экспортирован');
  } catch (e) {
    console.error(e);
    $toast.error(getErrorMessage(e));
  } finally {
    isExporting.value = false;
  }
};

const filterChips = computed((): FilterChip[] => {
  const chips: FilterChip[] = [];

  taskStore.filter.statuses.forEach((status) => {
    const chipId = `status-${status}`;
    chips.push({
      id: chipId,
      type: FilterType.STATUS,
      label: TASK_STATUS_LABELS[status as TASK_STATUSES],
      value: status,
      isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
    });
  });

  if (Array.isArray(taskStore.filter.projects)) {
    taskStore.filter.projects.forEach((projectId) => {
      const project = projectStore.projects.find((p) => p.id === projectId);
      if (project) {
        const chipId = `project-${projectId}`;
        chips.push({
          id: chipId,
          type: FilterType.PROJECT,
          label: project.name,
          value: projectId,
          isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
        });
      }
    });
  }

  taskStore.filter.responsibles.forEach((userId) => {
    const user = userStore.users.find((u: User) => u.id === userId);
    if (user) {
      const chipId = `responsible-${userId}`;
      chips.push({
        id: chipId,
        type: FilterType.RESPONSIBLE,
        label: useFullName(user) || '',
        value: userId,
        isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
      });
    }
  });

  taskStore.filter.taskTypes.forEach((taskType) => {
    const chipId = `taskType-${taskType}`;
    chips.push({
      id: chipId,
      type: FilterType.TASK_TYPE,
      label: taskType === TaskType.TASK ? 'Задача' : 'История',
      value: taskType,
      isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
    });
  });
  if (taskStore.filter.planned_date && taskStore.filter.planned_date.length > 0) {
    const dates = taskStore.filter.planned_date;
    const chipId = `date-${dates.join('-')}`;
    let label = '';
    if (dates.length === 2 && dates[0] === dates[1]) {
      label = `План: ${format(new Date(dates[0]), 'dd.MM.yyyy')}`;
    } else if (dates.length === 2) {
      label = `План: ${format(new Date(dates[0]), 'dd.MM.yyyy')} - ${format(new Date(dates[1]), 'dd.MM.yyyy')}`;
    } else {
      label = `План: до ${format(new Date(dates[0]), 'dd.MM.yyyy')}`;
    }
    chips.push({
      id: chipId,
      type: FilterType.DATE,
      label,
      value: dates.join(','),
      isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
    });
  }

  if (taskStore.filter.closed_date && taskStore.filter.closed_date.length > 0) {
    const dates = taskStore.filter.closed_date;
    const chipId = `closed_date-${dates.join('-')}`;
    let label = '';
    if (dates.length === 2 && dates[0] === dates[1]) {
      label = `Закрыто: ${format(new Date(dates[0]), 'dd.MM.yyyy')}`;
    } else if (dates.length === 2) {
      label = `Закрыто: ${format(new Date(dates[0]), 'dd.MM.yyyy')} - ${format(new Date(dates[1]), 'dd.MM.yyyy')}`;
    } else {
      label = `Закрыто: до ${format(new Date(dates[0]), 'dd.MM.yyyy')}`;
    }
    chips.push({
      id: chipId,
      type: FilterType.CLOSED_DATE,
      label,
      value: dates.join(','),
      isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
    });
  }

  if (taskStore.filter.title) {
    chips.push({
      id: 'search-title',
      type: FilterType.SEARCH,
      label: `Поиск: "${taskStore.filter.title}"`,
      value: taskStore.filter.title,
      isNegative: false,
    });
  }

  return chips;
});

const removeFilter = async (chipId: string) => {
  const [type, ...valueParts] = chipId.split('-');
  const value = valueParts.join('-');

  switch (type) {
    case FilterType.STATUS:
      taskStore.filter.statuses = taskStore.filter.statuses.filter((s) => s !== value);
      break;
    case FilterType.PROJECT:
      if (Array.isArray(taskStore.filter.projects)) {
        taskStore.filter.projects = taskStore.filter.projects.filter((p) => p !== Number(value));
      }
      break;
    case FilterType.RESPONSIBLE:
      taskStore.filter.responsibles = taskStore.filter.responsibles.filter((r) => r !== Number(value));
      break;
    case FilterType.TASK_TYPE:
      taskStore.filter.taskTypes = taskStore.filter.taskTypes.filter((t) => t !== value);
      break;
    case FilterType.DATE:
      taskStore.filter.planned_date = [];
      break;
    case FilterType.CLOSED_DATE:
      taskStore.filter.closed_date = [];
      break;
    case FilterType.SEARCH:
      taskStore.filter.title = undefined;
      if (filterPanelRef.value) {
        filterPanelRef.value.clearSearch();
      }
      break;
  }

  if (taskStore.filter.negativeFilters) {
    taskStore.filter.negativeFilters[chipId] = false;
  }

  await taskStore.saveFilterState();
  if (viewType.value === ViewType.LIST) fetchTasks();
  if (viewType.value === ViewType.KANBAN) fetchKanban();
  if (viewType.value === ViewType.WEEKLY) fetchWeekly();
};

const toggleFilterMode = async (chipId: string) => {
  if (!taskStore.filter.negativeFilters) {
    taskStore.filter.negativeFilters = {};
  }
  taskStore.filter.negativeFilters[chipId] = !taskStore.filter.negativeFilters[chipId];
  await taskStore.saveFilterState();
  if (viewType.value === ViewType.LIST) fetchTasks();
  if (viewType.value === ViewType.KANBAN) fetchKanban();
  if (viewType.value === ViewType.WEEKLY) fetchWeekly();
};

const addFilter = async (filter: { type: FilterType; value: string | number | string[]; isNegative: boolean }) => {
  const { type, value, isNegative: _isNegative } = filter;

  if (!taskStore.filter.negativeFilters) {
    taskStore.filter.negativeFilters = {};
  }

  let chipId = '';
  switch (type) {
    case FilterType.STATUS: {
      chipId = `status-${value}`;
      if (!taskStore.filter.statuses.includes(value as string)) {
        taskStore.filter.statuses.push(value as string);
      }
      break;
    }
    case FilterType.PROJECT: {
      chipId = `project-${value}`;
      if (Array.isArray(taskStore.filter.projects) && !taskStore.filter.projects.includes(value as number)) {
        taskStore.filter.projects.push(value as number);
      }
      break;
    }
    case FilterType.RESPONSIBLE: {
      chipId = `responsible-${value}`;
      if (!taskStore.filter.responsibles.includes(value as number)) {
        taskStore.filter.responsibles.push(value as number);
      }
      break;
    }
    case FilterType.TASK_TYPE: {
      chipId = `taskType-${value}`;
      if (!taskStore.filter.taskTypes.includes(value as TaskType)) {
        taskStore.filter.taskTypes.push(value as TaskType);
      }
      break;
    }
    case FilterType.DATE: {
      chipId = `date-${(value as string[]).join('-')}`;
      taskStore.filter.planned_date = value as string[];
      break;
    }
    case FilterType.CLOSED_DATE: {
      chipId = `closed_date-${(value as string[]).join('-')}`;
      taskStore.filter.closed_date = value as string[];
      break;
    }
  }

  if (chipId) {
    taskStore.filter.negativeFilters[chipId] = _isNegative;
  }

  await taskStore.saveFilterState();
  if (viewType.value === ViewType.LIST) fetchTasks();
  if (viewType.value === ViewType.KANBAN) fetchKanban();
  if (viewType.value === ViewType.WEEKLY) fetchWeekly();
};

const swapPriorityTask = async (taskIds: number[]) => {
  try {
    await taskStore.swapPriorityTask(taskIds);
  } catch (e) {
    console.log(e);
  }
};

const updateTask = async (taskId: number, task: { status: TASK_STATUSES }) => {
  try {
    await taskStore.updateTask(taskId, { status: task.status });
  } catch (e) {
    console.log(e);
  }
};

const taskTypeOptions = computed(() => {
  return [
    {
      label: 'История',
      value: TaskType.USER_STORY,
    },
    {
      label: 'Задача',
      value: TaskType.TASK,
    },
  ];
});

definePageMeta({
  middleware: 'auth',
  name: 'home',
});

useHead({
  title: 'Все задачи | Нервион',
});
</script>

<template>
  <div class="home">
    <div class="home__tasks-header">
      <div class="home__tasks-title">Задачи</div>
      <div class="home__task-header-right">
        <button class="create-task-button" @click="openCreateTaskSidebar">
          <IconsIconPlus />
          <span>Новая задача</span>
        </button>
      </div>
      <div v-if="isOpenTaskCreateModal" class="home__add-task">
        <div :class="['home-create-task-modal', { 'home-create-task-modal_pending': createTaskPending }]">
          <div class="home-create-task-modal__options">
            <BaseSelect
              v-model="newTask.project_id"
              reset-button
              :options="projectOptions"
              placeholder="Проект"
              @reset="newTask.project_id = null"
            />
            <BaseSelect
              v-model="newTask.responsible_id"
              reset-button
              :options="usersOptions"
              placeholder="Ответственный"
              @reset="newTask.responsible_id = null"
            />
            <BaseSelect v-model="newTask.status" :options="statusOptions" placeholder="Статус" />
          </div>
          <div class="home-create-task-modal__name">
            <input v-model="newTask.title" :maxlength="MAX_TASK_NAME_LENGTH" placeholder="Название" />
          </div>
          <div class="home-create-task-modal__description">
            <textarea maxlength="200" rows="8" placeholder="Описание" />
          </div>
          <button
            class="home-create-task-modal__create-task-button"
            :disabled="isDisabledCreateTaskButton || createTaskPending"
            @click="createTask"
          >
            <IconButtonLoader v-if="createTaskPending" class="btn__loader" />
            <IconsIconConfirm v-else />
          </button>
        </div>
      </div>
    </div>
    <div :class="['home__tasks-filters', { 'home__tasks-filters_mb-16': !filterChips.length }]">
      <TaskFilterPanel
        ref="filterPanelRef"
        :filters="filterChips"
        :status-options="statusOptions"
        :project-options="projectOptions"
        :user-options="usersOptions"
        :task-type-options="taskTypeOptions"
        :is-exporting="isExporting"
        @add-filter="addFilter"
        @search="handleSearch"
        @remove-filter="removeFilter"
        @toggle-filter-mode="toggleFilterMode"
        @export="handleExport"
      />

      <div v-if="filterChips && filterChips.length" class="home__filter-chips home__filter-chips_mob">
        <div v-for="chip in filterChips" :key="chip.id" class="home__filter-chip">
          <button
            class="home__filter-chip-toggle"
            :class="{ 'home__filter-chip-toggle_negative': chip.isNegative }"
            @click="toggleFilterMode(chip.id)"
          >
            <IconsIconEquality v-if="!chip.isNegative" />
            <IconsIconEqualityNot v-else />
          </button>
          <span class="home__filter-chip-label">{{ chip.label }}</span>
          <button class="home__filter-chip-remove" @click="removeFilter(chip.id)">
            <IconsIconCloseFilter />
          </button>
        </div>
      </div>

      <div class="toggle-view-type">
        <span
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.KANBAN }"
          @click="setViewType(ViewType.KANBAN)"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12.5 10.8337L12.5 3.33366M12.5 10.8337L16.167 10.8337C16.6337 10.8337 16.8668 10.8337 17.0451 10.7428C17.2019 10.6629 17.3293 10.5355 17.4092 10.3787C17.5 10.2005 17.5 9.96696 17.5 9.50024L17.5 3.33366L12.5 3.33366M12.5 10.8337L12.5 15.3336C12.5 15.8003 12.5 16.0338 12.4092 16.2121C12.3293 16.3689 12.2019 16.4963 12.0451 16.5762C11.8668 16.667 11.6337 16.667 11.167 16.667L8.83366 16.667C8.36695 16.667 8.1331 16.667 7.95484 16.5762C7.79804 16.4963 7.67104 16.3689 7.59115 16.2121C7.50032 16.0338 7.5 15.8003 7.5 15.3336L7.5 13.3337M12.5 3.33366L7.5 3.33366M7.5 3.33366L2.5 3.33358L2.5 12.0002C2.5 12.467 2.50032 12.7005 2.59115 12.8787C2.67104 13.0355 2.79755 13.1629 2.95436 13.2428C3.13262 13.3337 3.36662 13.3337 3.83333 13.3337L7.5 13.3337M7.5 3.33366L7.5 13.3337"
              stroke="white"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          Канбан
        </span>
        <span
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.LIST }"
          @click="setViewType(ViewType.LIST)"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M7.49984 14.1668H15.8332M7.49984 10.0002H15.8332M7.49984 5.8335H15.8332M4.16813 14.1668V14.1685L4.1665 14.1685V14.1668H4.16813ZM4.16813 10.0002V10.0018L4.1665 10.0018V10.0002H4.16813ZM4.16813 5.8335V5.83516L4.1665 5.83512V5.8335H4.16813Z"
              stroke="white"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          Список
        </span>
        <span
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.WEEKLY }"
          @click="setViewType(ViewType.WEEKLY)"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="4.5" width="15" height="13" rx="1.5" stroke="white" stroke-linecap="round" />
            <path d="M2.5 8H17.5" stroke="white" stroke-linecap="round" />
            <path d="M7 2.5V5.5" stroke="white" stroke-linecap="round" />
            <path d="M13 2.5V5.5" stroke="white" stroke-linecap="round" />
            <path d="M6 12H7" stroke="white" stroke-linecap="round" />
            <path d="M9.5 12H10.5" stroke="white" stroke-linecap="round" />
            <path d="M13 12H14" stroke="white" stroke-linecap="round" />
          </svg>

          Неделя
        </span>
      </div>
    </div>

    <div v-if="filterChips && filterChips.length" class="home__filter-chips">
      <div v-for="chip in filterChips" :key="chip.id" class="home__filter-chip">
        <button
          class="home__filter-chip-toggle"
          :class="{ 'home__filter-chip-toggle_negative': chip.isNegative }"
          @click="toggleFilterMode(chip.id)"
        >
          <IconsIconEquality v-if="!chip.isNegative" />
          <IconsIconEqualityNot v-else />
        </button>
        <span class="home__filter-chip-label">{{ chip.label }}</span>
        <button class="home__filter-chip-remove" @click="removeFilter(chip.id)">
          <IconsIconCloseFilter />
        </button>
      </div>
    </div>

    <hr />
    <div class="home__tasks-items">
      <template v-if="viewType === ViewType.KANBAN">
        <BaseKanban
          :key="String(taskStore.filter)"
          :columns="kanban"
          @click-to-card="openTaskSidebar"
          @swap-priority-task="swapPriorityTask"
          @update-task="updateTask"
          @toggle-collapse="onToggleCollapse"
          @load-more="onKanbanLoadMore"
        />
      </template>
      <template v-if="viewType === ViewType.WEEKLY">
        <WeeklyView />
      </template>
      <template v-if="viewType === ViewType.LIST">
        <div v-if="!taskStore.tasks.length && taskStore.isFilterFilled()" class="home__list-empty">
          <img src="@/assets/empty_filter.webp" alt="" />
          <h4>По вашему запросу ничего не найдено</h4>
          <span>Для устранения проблемы рекомендуем изменить параметры фильтров или уменьшить их значение</span>
        </div>
        <div v-if="!taskStore.tasks.length && !taskStore.isFilterFilled()" class="home__list-empty">
          <img src="@/assets/empty_tasks.webp" alt="" />
          <h4>Задач пока нет</h4>
          <span>Создайте свою первую задачу, чтобы начать работу в трекере.</span>
        </div>
        <div class="home__tasks" @dragover.prevent>
          <div
            v-for="(task, index) in taskStore.tasks"
            :key="task.id"
            draggable="true"
            @dragstart="onDragStart(index)"
            @dragenter.prevent="onDragEnter(index)"
            @dragend="onDragEnd"
          >
            <TaskComponent class="task" :task="task" :stop-timer="stopTimer" />
          </div>
        </div>
      </template>
    </div>

    <CreateTaskSidebar v-if="isCreateTaskSidebarOpen" @close="closeCreateTaskSidebar" />
  </div>
</template>

<style lang="scss" scoped>
.reset-filter-button {
  color: var(--white-50);
  @extend %p14-bold;
}

.create-task-button {
  @extend %text-s-regular;

  svg {
    stroke: var(--light-text-backgroung-primary);
  }
}

.loader {
  &__wrapper {
    @include flex(center);
    height: 100%;
  }
}

.home-create-task-modal {
  z-index: 100;
  position: absolute;
  border-radius: 16px;
  background: var(--black-50);
  backdrop-filter: blur(12px);
  padding: 24px;
  top: 46px;
  left: 0;

  &__options {
    display: flex;
    gap: 12px;
  }

  &__description {
    margin-top: 16px;
    textarea {
      height: 160px;
      width: 100%;
      padding: 18px 20px;
      border-radius: 12px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--white-100);
      @extend %p14-medium;

      &::placeholder {
        color: var(--white-50);
      }
    }
  }

  &__name {
    margin-top: 24px;
    input {
      width: 100%;
      padding: 18px 20px;
      border-radius: 12px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--white-100);
      @extend %p14-medium;

      &::placeholder {
        color: var(--white-50);
      }
    }
  }

  &__create-task-button {
    margin-top: 24px;
    margin-left: auto;
    @include flex(center);
    border-radius: 8px;
    width: 32px;
    height: 32px;
    background: var(--primary-100);

    svg {
      width: 24px;
      height: 24px;
    }

    &_grey {
      background: var(--white-50);
    }
  }

  &_pending {
    & > div {
      filter: blur(2px);
    }
  }
}

.home {
  width: 100%;
  height: 100dvh;
  padding: 16px;
  min-width: 0;
  flex: 1;
  @include flex(cn);

  &__task-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }
  &__tasks-header {
    flex-wrap: wrap;
    align-items: center;
    display: flex;
    margin-bottom: 16px;
    gap: 12px;
  }
  &__open-modal {
    border-radius: 1000px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.5s ease;
    transform: rotate(0deg);
    border: 1px solid var(--light-text-backgroung-primary-5);
  }
  &__add-task {
    position: relative;
    cursor: pointer;

    &_rotate {
      transition: transform 0.5s ease;
      transform: rotate(45deg);
    }
  }

  &__tasks-title {
    @extend %display-xs-medium;
  }

  &__tasks-filter {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  &__tasks-filters {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 12px;
    margin-bottom: 8px;

    @media (max-width: $screen-mobile-l) {
      margin-bottom: 16px;
    }

    &_mb-16 {
      margin-bottom: 16px;
    }

    @media (max-width: $screen-mobile-l) {
      flex-wrap: wrap;
      flex-direction: column;
      align-items: start;
      gap: 0;
    }
  }

  &__task-filters {
    display: flex;
    align-items: flex-start;
    color: var(--white-50);

    gap: 16px;
    @extend %p12-semi;
    padding: 8px 0;
    justify-content: space-between;
  }

  &__tasks-notification {
    margin-left: unset;
  }

  &__filter-chips {
    @include flex(a-center);
    gap: 6px;
    flex-wrap: wrap;
    padding: 0;
    margin-bottom: 16px;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    &_mob {
      display: none;

      @media (max-width: $screen-mobile-l) {
        display: flex;
        margin-bottom: 0;
        margin-top: 8px;
      }
    }
  }

  &__filter-chip {
    @include flex(a-center);
    gap: 2px;
    padding: 2px 4px 2px 2px;
    border-radius: 4px;
    background: var(--primary-25);
    height: 24px;
  }

  &__filter-chip-toggle {
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border-radius: 2px;
    transition: background 0.2s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &_negative {
      svg rect {
        fill: var(--danger-delete-25);
      }
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__filter-chip-label {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
  }

  &__filter-chip-remove {
    padding: 0;
    @include flex(center);
    width: 20px;
    height: 20px;
    background: transparent;
    border-radius: 2px;
    transition: background 0.2s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__tasks-reload {
    width: 40px;
    height: 40px;
    @include flex(center);
    border-radius: 1000px;
    border: 1px solid var(--light-text-backgroung-primary-5);
    cursor: pointer;
  }

  &__tasks-items {
    height: 100%;
    width: 100%;
    margin-top: 16px;
    overflow: auto;

    // чтобы контент не уходил под фиксированную нижнюю нав-панель
    @media (max-width: $screen-mobile-l) {
      padding-bottom: var(--mobile-nav-h);
    }
  }

  &__list-empty {
    height: 100%;
    @include flex(cn, center);
    gap: 4px;
    color: var(--white-100);

    img {
      width: 310px;
      height: auto;
    }

    h4 {
      @extend %display-m-medium;
      width: 340px;
      text-align: center;
    }

    span {
      @extend %text-m-regular;
      width: 340px;
      text-align: center;
    }
  }

  &__tasks {
    height: max-content;
    @include flex(cn);
    gap: 4px;
  }
}

.toggle-view-type {
  margin-left: auto;
  display: flex;
  gap: 12px;

  @media (max-width: $screen-mobile-l) {
    margin-top: 16px;
  }

  &__button {
    cursor: pointer;
    @include flex(a-center);
    gap: 4px;
    color: var(--light-text-backgroung-primary-50);

    svg {
      stroke-opacity: 0.5;
    }

    border-bottom: 1px solid transparent;
    padding-bottom: 4px;
    @extend %text-s-medium;

    &_active {
      color: var(--light-text-backgroung-primary);
      border-bottom: 1px solid var(--primary);

      svg {
        stroke-opacity: 1;
      }
    }
  }
}
</style>
