<script setup lang="ts">
import type { FilterChip } from '~/types/filter';
import { TaskBusinessKind } from '@tracker/contracts';
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
import { CalendarDays, LayoutDashboard, List, Search, X } from '@lucide/vue';
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
const pendingViewRequests = ref(0);
const isTasksLoading = computed(() => pendingViewRequests.value > 0);

const withTasksLoading = async (request: () => Promise<unknown>) => {
  pendingViewRequests.value += 1;
  try {
    return await request();
  } finally {
    pendingViewRequests.value = Math.max(0, pendingViewRequests.value - 1);
  }
};

const onKanbanLoadMore = async ({ status, offset, done }: { status: string; offset: number; done?: () => void }) => {
  try {
    await taskStore.loadMoreColumn(status, { useSavedFilters: true }, offset);
  } catch (error) {
    $toast.error(getErrorMessage(error));
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
const viewType = computed<ViewType>(() => (taskStore.viewType as ViewType) ?? ViewType.LIST);

const onToggleCollapse = (payload: { status: TASK_STATUSES; collapsed: boolean }) => {
  taskStore.setColumnCollapsed(payload.status, payload.collapsed);
};

const fetchTasks = async () => {
  try {
    await withTasksLoading(() => taskStore.fetchTasks({ useSavedFilters: true }));
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchKanban = async () => {
  try {
    await withTasksLoading(() => getKanban({ useSavedFilters: true }));
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const fetchWeekly = async () => {
  try {
    await withTasksLoading(() => taskStore.refreshWeeklyTasks());
  } catch (e) {
    console.log(e);
    $toast.error(getErrorMessage(e));
  }
};

const loadTasksPageData = async () => {
  if (taskStore.tasksPageHydrated) {
    return {
      viewType: viewType.value,
      myTodayTasksCount: taskStore.myTodayTasksCount,
    };
  }

  await taskStore.getFilterState();

  const jobs: Promise<unknown>[] = [taskStore.fetchMyTodayTasksCount(userStore.user?.id)];
  if (viewType.value === ViewType.LIST) jobs.push(fetchTasks());
  if (viewType.value === ViewType.KANBAN) jobs.push(fetchKanban());
  if (viewType.value === ViewType.WEEKLY) jobs.push(fetchWeekly());

  await Promise.all(jobs);
  taskStore.tasksPageHydrated = true;

  return {
    viewType: viewType.value,
    myTodayTasksCount: taskStore.myTodayTasksCount,
  };
};

watch(
  () => taskStore.businessKind,
  () => {
    if (viewType.value === ViewType.LIST) void fetchTasks();
    if (viewType.value === ViewType.KANBAN) void fetchKanban();
    if (viewType.value === ViewType.WEEKLY) void fetchWeekly();
  },
);

await useAsyncData(
  'tasks-page-data',
  async () => {
    try {
      return await loadTasksPageData();
    } catch (e) {
      console.log(e);
      $toast.error(getErrorMessage(e));
      return null;
    }
  },
  {
    getCachedData: (key, nuxtApp) =>
      taskStore.tasksPageHydrated ? (nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]) : undefined,
  },
);

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

watch(
  () => projectStore.revision,
  () => {
    if (viewType.value === ViewType.LIST) void fetchTasks();
    if (viewType.value === ViewType.KANBAN) void fetchKanban();
    if (viewType.value === ViewType.WEEKLY) void fetchWeekly();
  },
);

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
const mobileFilterPanelRef = ref<{ clearSearch: () => void } | null>(null);
const isMobileSearchOpen = ref(false);
const isDesktopFilterPanelVisible = ref(false);
let desktopFilterMediaQuery: MediaQueryList | null = null;

const syncDesktopFilterPanelVisibility = () => {
  isDesktopFilterPanelVisible.value = desktopFilterMediaQuery?.matches ?? false;
};

onMounted(() => {
  desktopFilterMediaQuery = window.matchMedia('(min-width: 481px)');
  syncDesktopFilterPanelVisibility();
  desktopFilterMediaQuery.addEventListener('change', syncDesktopFilterPanelVisibility);
});

onBeforeUnmount(() => {
  desktopFilterMediaQuery?.removeEventListener('change', syncDesktopFilterPanelVisibility);
});

const openCreateTaskSidebar = () => {
  isCreateTaskSidebarOpen.value = true;
};

const closeCreateTaskSidebar = () => {
  isCreateTaskSidebarOpen.value = false;
};

const openMobileSearch = () => {
  isMobileSearchOpen.value = true;
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
      const chipId = `project-${projectId}`;
      chips.push({
        id: chipId,
        type: FilterType.PROJECT,
        label: project?.name ?? `Недоступный проект #${projectId}`,
        value: projectId,
        isNegative: taskStore.filter.negativeFilters?.[chipId] || false,
      });
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

  if (userStore.user?.role === 'admin' && taskStore.businessKind) {
    chips.push({
      id: `${FilterType.BUSINESS_KIND}-${taskStore.businessKind}`,
      type: FilterType.BUSINESS_KIND,
      label: taskStore.businessKind === TaskBusinessKind.SALES ? 'Продажи' : 'Производство',
      value: taskStore.businessKind,
      isNegative: false,
      canNegate: false,
    });
  }
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
    case FilterType.BUSINESS_KIND:
      taskStore.businessKind = '';
      return;
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
    case FilterType.BUSINESS_KIND: {
      taskStore.businessKind = value as TaskBusinessKind;
      return;
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

const getTodayDate = () => format(new Date(), 'yyyy-MM-dd');

const hasNoExtraFilters = () => {
  const { statuses, projects, closed_date, taskTypes, title, negativeFilters } = taskStore.filter;
  const hasProjects = Array.isArray(projects) ? projects.length > 0 : projects === 'null';
  const hasNegative = negativeFilters ? Object.values(negativeFilters).some(Boolean) : false;

  return (
    !statuses.length &&
    !hasProjects &&
    !closed_date?.length &&
    !taskTypes.length &&
    !title?.trim() &&
    !hasNegative &&
    !taskStore.businessKind
  );
};

const isTodayFilterActive = computed(() => {
  const me = userStore.user?.id;
  if (!me) return false;

  const dates = taskStore.filter.planned_date;
  const today = getTodayDate();
  const isTodayDate = !!dates && dates.length === 2 && dates[0] === today && dates[1] === today;
  const isOnlyMe = taskStore.filter.responsibles.length === 1 && taskStore.filter.responsibles[0] === me;

  return isTodayDate && isOnlyMe && hasNoExtraFilters();
});

const refreshCurrentView = () => {
  if (viewType.value === ViewType.LIST) fetchTasks();
  if (viewType.value === ViewType.KANBAN) fetchKanban();
  if (viewType.value === ViewType.WEEKLY) fetchWeekly();
};

const resetFiltersLocal = () => {
  taskStore.filter.statuses = [];
  taskStore.filter.projects = [];
  taskStore.filter.responsibles = [];
  taskStore.filter.planned_date = [];
  taskStore.filter.closed_date = [];
  taskStore.filter.taskTypes = [];
  taskStore.businessKind = '';
  taskStore.filter.negativeFilters = {};
  taskStore.filter.title = undefined;
  filterPanelRef.value?.clearSearch();
  mobileFilterPanelRef.value?.clearSearch();
};

const toggleTodayFilter = async () => {
  if (isTodayFilterActive.value) {
    resetFiltersLocal();
    await taskStore.saveFilterState();
    refreshCurrentView();
    return;
  }

  const me = userStore.user?.id;
  if (!me) return;

  const today = getTodayDate();
  resetFiltersLocal();
  taskStore.filter.responsibles = [me];
  taskStore.filter.planned_date = [today, today];
  await taskStore.saveFilterState();
  refreshCurrentView();
};

const toggleTodayFilterFromMobile = async () => {
  await toggleTodayFilter();
  isMobileSearchOpen.value = false;
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

const businessKindOptions: SelectOption[] = [
  { label: 'Продажи', value: TaskBusinessKind.SALES },
  { label: 'Производство', value: TaskBusinessKind.PRODUCTION },
];

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
        v-show="isDesktopFilterPanelVisible"
        ref="filterPanelRef"
        class="home__desktop-filter-panel"
        :filters="filterChips"
        :status-options="statusOptions"
        :project-options="projectOptions"
        :user-options="usersOptions"
        :task-type-options="taskTypeOptions"
        :business-kind-options="userStore.user?.role === 'admin' ? businessKindOptions : []"
        :search-value="taskStore.filter.title || ''"
        :is-exporting="isExporting"
        @add-filter="addFilter"
        @search="handleSearch"
        @remove-filter="removeFilter"
        @toggle-filter-mode="toggleFilterMode"
        @export="handleExport"
      />

      <label
        v-show="isDesktopFilterPanelVisible"
        class="home__today-filter"
        :class="{ 'home__today-filter_active': isTodayFilterActive }"
      >
        <input type="checkbox" :checked="isTodayFilterActive" @change="toggleTodayFilter" />
        <span>Мои сегодня</span>
      </label>

      <div class="toggle-view-type">
        <button
          type="button"
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.KANBAN }"
          aria-label="Канбан"
          @click="setViewType(ViewType.KANBAN)"
        >
          <LayoutDashboard :size="20" :stroke-width="1.75" aria-hidden="true" />
          <span class="toggle-view-type__label">Канбан</span>
        </button>
        <button
          type="button"
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.WEEKLY }"
          aria-label="Неделя"
          @click="setViewType(ViewType.WEEKLY)"
        >
          <CalendarDays :size="20" :stroke-width="1.75" aria-hidden="true" />
          <span class="toggle-view-type__label">Неделя</span>
          <span v-if="taskStore.myTodayTasksCount > 0" class="toggle-view-type__badge">
            {{ taskStore.myTodayTasksCount }}
          </span>
        </button>
        <button
          type="button"
          class="toggle-view-type__button"
          :class="{ 'toggle-view-type__button_active': viewType === ViewType.LIST }"
          aria-label="Список"
          @click="setViewType(ViewType.LIST)"
        >
          <List :size="20" :stroke-width="1.75" aria-hidden="true" />
          <span class="toggle-view-type__label">Список</span>
        </button>
      </div>

      <button
        type="button"
        class="home__mobile-search-button"
        :class="{ 'home__mobile-search-button_active': filterChips.length > 0 }"
        aria-label="Открыть поиск и фильтры"
        aria-haspopup="dialog"
        :aria-expanded="isMobileSearchOpen"
        @click="openMobileSearch"
      >
        <Search :size="20" :stroke-width="1.75" aria-hidden="true" />
        <span v-if="filterChips.length" class="home__mobile-search-count">{{ filterChips.length }}</span>
      </button>
    </div>

    <div v-if="filterChips && filterChips.length" class="home__filter-chips">
      <div v-for="chip in filterChips" :key="chip.id" class="home__filter-chip">
        <button
          v-if="chip.canNegate !== false"
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
    <div class="home__tasks-items" :aria-busy="isTasksLoading">
      <TasksViewSkeleton v-if="isTasksLoading" :view="viewType" />
      <template v-else-if="viewType === ViewType.KANBAN">
        <BaseKanban
          :key="String(taskStore.filter)"
          :quick-create-enabled="isDesktopFilterPanelVisible"
          :columns="kanban"
          @click-to-card="openTaskSidebar"
          @swap-priority-task="swapPriorityTask"
          @update-task="updateTask"
          @toggle-collapse="onToggleCollapse"
          @load-more="onKanbanLoadMore"
          @task-created="fetchKanban"
        />
      </template>
      <template v-else-if="viewType === ViewType.WEEKLY">
        <WeeklyView />
      </template>
      <template v-else>
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

    <BaseModal v-model="isMobileSearchOpen" class="home__mobile-search-modal">
      <section class="mobile-task-search" aria-labelledby="mobile-task-search-title">
        <header class="mobile-task-search__header">
          <h2 id="mobile-task-search-title" class="mobile-task-search__title">Поиск и фильтры</h2>
          <button
            type="button"
            class="mobile-task-search__close"
            aria-label="Закрыть поиск и фильтры"
            @click="isMobileSearchOpen = false"
          >
            <X :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </header>
        <TaskFilterPanel
          ref="mobileFilterPanelRef"
          :filters="filterChips"
          :status-options="statusOptions"
          :project-options="projectOptions"
          :user-options="usersOptions"
          :task-type-options="taskTypeOptions"
          :business-kind-options="userStore.user?.role === 'admin' ? businessKindOptions : []"
          :search-value="taskStore.filter.title || ''"
          :show-export="false"
          @add-filter="addFilter"
          @search="handleSearch"
          @remove-filter="removeFilter"
          @toggle-filter-mode="toggleFilterMode"
        />
        <label
          class="home__today-filter mobile-task-search__today"
          :class="{ 'home__today-filter_active': isTodayFilterActive }"
        >
          <input type="checkbox" :checked="isTodayFilterActive" @change="toggleTodayFilterFromMobile" />
          <span>Мои сегодня</span>
        </label>
      </section>
    </BaseModal>
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

  @media (max-width: $screen-mobile-l) {
    min-height: 44px;
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

  @media (max-width: $screen-mobile-l) {
    padding-right: var(--mobile-page-gutter);
    padding-left: var(--mobile-page-gutter);
  }

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
      width: 100%;
      flex-wrap: nowrap;
      align-items: center;
      gap: 8px;
    }
  }

  &__desktop-filter-panel {
    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__today-filter {
    @include flex(a-center);
    gap: 8px;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-medium;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--primary-50);
    transition:
      color 0.2s,
      background 0.2s,
      border-color 0.2s;

    input {
      width: 14px;
      height: 14px;
      accent-color: var(--primary);
      cursor: pointer;
    }

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--primary-5);
    }

    &_active {
      color: var(--light-text-backgroung-primary);
      background: var(--primary-10);
      border-color: var(--primary);
    }

    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__mobile-search-button {
    display: none;

    @media (max-width: $screen-mobile-l) {
      position: relative;
      @include flex(center);
      width: 44px;
      height: 44px;
      padding: 0;
      margin-left: auto;
      flex: 0 0 44px;
      border: 0;
      border-bottom: 1px solid transparent;
      border-radius: 0;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);

      &:hover,
      &_active {
        color: var(--light-text-backgroung-primary);
      }

      &_active {
        border-bottom-color: var(--primary);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    }
  }

  &__mobile-search-count {
    position: absolute;
    top: 4px;
    right: 1px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    @include flex(center);
    @extend %text-xs-medium;
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
      margin-bottom: 8px;
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

  &__button {
    cursor: pointer;
    @include flex(a-center);
    gap: 4px;
    padding: 0 0 4px;
    border: none;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    font: inherit;

    svg {
      flex-shrink: 0;
    }

    @extend %text-s-medium;

    &:hover {
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }

    &_active {
      color: var(--light-text-backgroung-primary);
      border-bottom: 1px solid var(--primary);
    }
  }

  &__badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    @include flex(center);
    @extend %text-xs-medium;
  }

  @media (max-width: $screen-mobile-l) {
    margin-top: 0;
    margin-left: 0;
    gap: 8px;

    &__button {
      min-width: 44px;
      min-height: 44px;
      justify-content: center;
      padding: 0 8px 4px;
    }

    &__label {
      display: none;
    }
  }
}

.mobile-task-search {
  @include flex(cn);
  gap: 16px;
  padding: 0 20px;

  &__header {
    @include flex(rn between a-center);
    gap: 16px;
  }

  &__title {
    margin: 0;
    color: var(--light-text-backgroung-primary);
    @extend %display-xs-medium;
  }

  &__close {
    width: 44px;
    height: 44px;
    padding: 0;
    flex: 0 0 44px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @include flex(center);

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
  }

  &__today {
    display: flex;
    align-self: flex-start;
  }
}

.home__mobile-search-modal {
  :deep(.base-modal__header) {
    display: none;
  }

  :deep(.base-modal__content) {
    width: min(100%, 420px);
  }

  :deep(.add-filter-dropdown__types) {
    width: calc(100vw - 104px);
    max-width: 316px;
  }

  :deep(.add-filter-dropdown__values) {
    top: 0 !important;
    left: 0;
    width: 100%;
  }
}
</style>
