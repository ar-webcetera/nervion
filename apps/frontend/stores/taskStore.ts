import { defineStore } from 'pinia';
import { ref } from 'vue';
import { format } from 'date-fns';
import type { Task, TaskParams, WeeklyTasksResponse } from '~/types/task';
import type { Project } from '~/types/project';
import type { User } from '~/types/user';
import type { TASK_STATUSES } from '~/constants/task.constants';
import type { JSONContent } from '@tiptap/core';
import type { TaskType } from '~/enums/task.enums';
import { extractPlainText, type TiptapDoc } from '~/utils/extractPainText';
import { useTimelogStore } from './timelogStore';
import { useUserStore } from './userStore';
import type { TaskBillingType } from '@tracker/contracts';

interface ExportTasksParams {
  statuses?: string[];
  projects?: number[];
  responsibles?: number[];
  taskTypes?: string[];
  planned_date?: string[];
  closed_date?: string[];
  year?: number;
  title?: string;
  useSavedFilters?: boolean;
  timezone?: string;
}

interface Filter {
  statuses: string[];
  projects: number[] | 'null';
  responsibles: number[];
  existTimelog?: boolean;
  planned_date: string[];
  closed_date: string[];
  taskTypes: TaskType[];
  negativeFilters?: Record<string, boolean>;
  title?: string;
  view_type?: TaskViewType;
  collapsed_columns?: string[];
}

interface GetTasksParams {
  statuses: string[];
  projects: number[] | 'null';
  responsibles: number[];
  existTimelog: boolean;
  planned_date: string[];
  closed_date: string[];
  year: number;
  taskTypes: TaskType[];
  title: string;
  useSavedFilters?: boolean;
  timezone?: string;
}

interface UpdateTasksOptions {
  project_id?: number;
  status?: TASK_STATUSES;
  responsible_id?: number | number[] | null;
  description?: JSONContent;
  title?: string;
  planned_date?: string | null;
  taskType?: TaskType;
  story_points?: number | null;
  recurrence_days?: number[] | null;
  billing_type?: TaskBillingType | null;
  fixed_price?: number | null;
}

export interface KanbanCard {
  id: number | string;
  title: string;
  description?: string;
  status: TASK_STATUSES;
  priority: number;
  users?: string[];
  projectName?: string;
  taskType?: TaskType;
  coverImage?: string;
  story_points?: number | null;
  planned_date?: string | null;
  closed_date?: string | null;
}

export interface KanbanColumn {
  id: number | string;
  title: string;
  status: TASK_STATUSES;
  cards: KanbanCard[];
  total?: number;
  collapsed?: boolean;
}

export type TaskViewType = 'kanban' | 'list' | 'weekly';

export interface KanbanParams {
  projects: number[] | 'null';
  taskTypes: TaskType[];
  responsibles: number[];
  statuses: string[];
  planned_date: string[];
  closed_date?: string[];
  useSavedFilters?: boolean;
  timezone?: string;
}

export const useTaskStore = defineStore('task', () => {
  const config = useRuntimeConfig();
  const { $api } = useNuxtApp();
  const timelogStore = useTimelogStore();
  const summary = ref<string>('');
  const startTime = ref<number>(0);
  const timer = ref<ReturnType<typeof setInterval> | null>(null);
  const users = ref<User[]>([]);
  const projects = ref<Project[]>([]);
  const accumulatedTime = ref<number>(0);
  const labels = ref([]);
  const tasks = ref<Task[]>([]);
  const tasksWithTimelogs = ref<Task[]>([]);
  const currentTask = ref<Task | null>(null);
  const currentTaskId = ref<number | null>(null);
  const currentTaskDate = ref<string | null>(null);
  const kanban = ref<KanbanColumn[]>([]);
  const viewType = ref<TaskViewType>('list');
  const tasksPageHydrated = ref(false);
  const filter = ref<Filter>({
    statuses: [],
    projects: [],
    responsibles: [],
    planned_date: [],
    closed_date: [],
    taskTypes: [],
    negativeFilters: {},
  });
  const endModal = ref<HTMLElement | null>(null);

  const getTrackingDateFromTimelogs = (taskId: number) => {
    return timelogStore.currentTimelogs.find((timelog) => timelog.task_id === taskId)?.tracking_date ?? null;
  };

  const unlinkTask = async (taskId: number, relatedTaskId: number) => {
    await $fetch(`/api/tasks/${taskId}/links`, {
      method: 'DELETE',
      body: { relatedTaskId },
      baseURL: config.public.API_URL,
      credentials: 'include',
    });
  };

  const createAndLinkTask = async (taskId: number, task: { title: string; project_id: number }) => {
    return await $fetch<Task>(`/api/tasks/${taskId}/links/create`, {
      method: 'POST',
      body: { ...task },
      baseURL: config.public.API_URL,
      credentials: 'include',
    });
  };

  const saveFilterState = async () => {
    const { statuses, projects, responsibles, planned_date, closed_date, taskTypes, negativeFilters, title } = filter.value;
    const body = {
      statuses,
      projects,
      responsibles,
      planned_date,
      closed_date,
      taskTypes,
      negativeFilters: negativeFilters ? { ...negativeFilters } : {},
      title,
    };

    await $fetch(`/api/tasks/filter-state`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
  };

  const getFilterState = async () => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<Filter>(`/api/tasks/filter-state`, {
      method: 'GET',
      credentials: 'include',
      baseURL: config.public.API_URL,
      headers,
    });
    filter.value = {
      statuses: response.statuses || [],
      projects: response.projects || [],
      responsibles: response.responsibles || [],
      planned_date: response.planned_date || [],
      closed_date: response.closed_date || [],
      taskTypes: response.taskTypes || [],
      negativeFilters: response.negativeFilters || {},
      title: response.title,
    };
    viewType.value = response.view_type || 'list';
    return response;
  };

  const setColumnCollapsed = async (status: TASK_STATUSES, collapsed: boolean) => {
    const column = kanban.value.find((c) => c.status === status);
    if (!column) return;

    const previous = column.collapsed;
    column.collapsed = collapsed;
    const collapsed_columns = kanban.value.filter((c) => c.collapsed).map((c) => c.status);

    try {
      await $fetch(`/api/tasks/kanban-columns`, {
        method: 'PATCH',
        credentials: 'include',
        baseURL: config.public.API_URL,
        body: { collapsed_columns },
      });
    } catch (e) {
      column.collapsed = previous;
      throw e;
    }
  };

  const saveViewType = async (view_type: TaskViewType) => {
    const previous = viewType.value;
    viewType.value = view_type;

    try {
      await $fetch(`/api/tasks/view-type`, {
        method: 'PATCH',
        credentials: 'include',
        baseURL: config.public.API_URL,
        body: { view_type },
      });
    } catch (e) {
      viewType.value = previous;
      throw e;
    }
  };

  const isFilterFilled = () => {
    const { statuses, projects, responsibles, planned_date, closed_date, taskTypes, negativeFilters, title } = filter.value;
    const hasProjects = Array.isArray(projects) ? projects.length > 0 : projects === 'null';
    const hasNegative = negativeFilters ? Object.values(negativeFilters).some(Boolean) : false;

    return (
      statuses.length > 0 ||
      hasProjects ||
      responsibles.length > 0 ||
      (planned_date && planned_date.length > 0) ||
      (closed_date && closed_date.length > 0) ||
      taskTypes.length > 0 ||
      Boolean(title?.trim()) ||
      hasNegative
    );
  };

  const fetchTasks = async ({
    statuses,
    projects,
    responsibles,
    planned_date,
    closed_date,
    year,
    taskTypes,
    title,
    useSavedFilters,
    timezone,
  }: Partial<GetTasksParams>) => {
    const headers = useRequestHeaders(['cookie']);
    const params: Partial<GetTasksParams> = {};
    if (statuses) params.statuses = statuses;
    if (projects) params.projects = projects;
    if (responsibles) params.responsibles = responsibles;
    if (planned_date) params.planned_date = planned_date;
    if (closed_date) params.closed_date = closed_date;
    if (year) params.year = year;
    if (taskTypes) params.taskTypes = taskTypes;
    if (title) params.title = title;
    if (useSavedFilters) params.useSavedFilters = useSavedFilters;
    params.timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await $fetch<Task[]>(`/api/tasks/`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params,
    });
    tasks.value =
      response?.map((task) => ({
        ...task,
        active_tracking_date: getTrackingDateFromTimelogs(task.id),
      })) || [];
    return response || [];
  };

  const getKanban = async (params: Partial<KanbanParams>) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<KanbanColumn[]>(`/api/tasks/kanban`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params: { ...params, timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone },
    });

    kanban.value = response || [];
    return response || [];
  };

  const loadMoreColumn = async (status: string, params: Partial<KanbanParams>, offset: number, limit = 50) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<{ status: string; total: number; cards: KanbanCard[] }>(`/api/tasks/kanban/column`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params: {
        ...params,
        status,
        offset,
        limit,
        timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    const column = kanban.value.find((c) => c.status === status);
    if (column && response) {
      const seen = new Set(column.cards.map((c) => c.id));
      column.cards.push(...response.cards.filter((c) => !seen.has(c.id)));
      column.total = response.total;
    }
    return response;
  };

  const fetchTasksWithTimelogs = async () => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<Task[]>(`/api/tasks/`, {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
      params: { existTimelog: true },
    });
    tasksWithTimelogs.value =
      response?.map((task) => ({
        ...task,
        active_tracking_date: getTrackingDateFromTimelogs(task.id),
      })) || [];
  };

  const fetchTask = async (taskId: number) => {
    const headers = useRequestHeaders(['cookie']);
    const task = await $fetch<Task>(`/api/tasks/${taskId}`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
    });
    currentTask.value = {
      ...task,
      active_tracking_date: getTrackingDateFromTimelogs(task.id),
    };
    return currentTask.value;
  };

  const sendTimelog = async (taskInfo: TaskParams) => {
    await $api.post(`/timelogs`, taskInfo);
  };

  const updateTask = async (id: number, updateTaskOptions: UpdateTasksOptions = {}) => {
    const body: Partial<Task> = {};
    if (updateTaskOptions.responsible_id) body.responsible_id = Number(updateTaskOptions.responsible_id);
    if (updateTaskOptions.responsible_id === null) body.responsible_id = null;
    if (updateTaskOptions.status) body.status = updateTaskOptions.status;
    if (updateTaskOptions.project_id) body.project_id = Number(updateTaskOptions.project_id);
    if (updateTaskOptions.description) body.description = updateTaskOptions.description;
    if (updateTaskOptions.title) body.title = updateTaskOptions.title;
    if (updateTaskOptions.taskType) body.taskType = updateTaskOptions.taskType;
    if (updateTaskOptions.planned_date || updateTaskOptions.planned_date === null) {
      body.planned_date = updateTaskOptions.planned_date;
    }
    if (updateTaskOptions.story_points !== undefined) body.story_points = updateTaskOptions.story_points;
    if (updateTaskOptions.recurrence_days !== undefined) body.recurrence_days = updateTaskOptions.recurrence_days;
    if (updateTaskOptions.billing_type !== undefined) body.billing_type = updateTaskOptions.billing_type;
    if (updateTaskOptions.fixed_price !== undefined) body.fixed_price = updateTaskOptions.fixed_price;
    await $fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
  };

  const deleteTask = async (id: number) => {
    await $fetch(`/api/tasks/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
  };

  const swapPriorityTask = async (ids: number[]) => {
    await $fetch(`/api/tasks/priority/swap`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: { ids },
    });
  };

  const createTask = async (taskInfo: Partial<Task>) => {
    const body: Partial<Task> = {};
    if (taskInfo.title) body.title = taskInfo.title;
    if (taskInfo.description) body.description = taskInfo.description;
    if (taskInfo.project_id) body.project_id = taskInfo.project_id;
    if (taskInfo.responsible_id) body.responsible_id = taskInfo.responsible_id;
    if (taskInfo.status) body.status = taskInfo.status;
    if (taskInfo.taskType) body.taskType = taskInfo.taskType;
    if (taskInfo.planned_date) body.planned_date = taskInfo.planned_date;
    const task = await $fetch<Task>(`/api/tasks/`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
    tasks.value.unshift(task);
    return task;
  };

  const duplicateTask = async (id: number) => {
    const task = await $fetch<Task>(`/api/tasks/${id}/duplicate`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
    tasks.value.unshift(task);
    return task;
  };

  const linkExistingTask = async (id: number, relatedTaskId: number) => {
    await $fetch(`/api/tasks/${id}/links`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: { relatedTaskId },
    });
  };

  const openModal = () => {
    if (!endModal.value) return;
  };

  const weeklyTasks = ref<WeeklyTasksResponse | null>(null);
  const currentViewingWeekStart = ref<string | null>(null);
  const myTodayTasksCount = ref(0);

  const fetchWeeklyTasks = async (weekStart?: string, useSavedFilters = true) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<WeeklyTasksResponse>(`/api/tasks/weekly`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params: {
        ...(weekStart ? { week_start: weekStart } : {}),
        ...(useSavedFilters ? { useSavedFilters: true } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    weeklyTasks.value = response;
    currentViewingWeekStart.value = response.week_start;
    return response;
  };

  const refreshWeeklyTasks = () => fetchWeeklyTasks(currentViewingWeekStart.value ?? undefined);

  const fetchMyTodayTasksCount = async (userId?: number) => {
    const responsibleId = userId ?? useUserStore().user?.id;
    if (!responsibleId) {
      myTodayTasksCount.value = 0;
      return 0;
    }

    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<WeeklyTasksResponse>(`/api/tasks/weekly`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params: {
        responsibles: [responsibleId],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    const today = format(new Date(), 'yyyy-MM-dd');
    const todayColumn = response.columns.find((column) => column.date === today);
    myTodayTasksCount.value =
      todayColumn?.cards.filter((card) => !card.completed && card.responsible?.id === responsibleId).length ?? 0;
    return myTodayTasksCount.value;
  };

  const refreshMyTodayTasksCountIfNeeded = async (date: string) => {
    if (date !== format(new Date(), 'yyyy-MM-dd')) return;
    await fetchMyTodayTasksCount();
  };

  const applyRecurrenceChangeToWeeklyView = (taskId: number, newRecurrenceDays: number[] | null) => {
    if (!weeklyTasks.value || !currentTask.value) return;
    const todayStr = new Date().toISOString().substring(0, 10);
    for (const column of weeklyTasks.value.columns) {
      const dayOfWeek = new Date(column.date + 'T12:00:00').getDay();
      const willRecurOnDay = newRecurrenceDays?.includes(dayOfWeek) ?? false;
      const cardIndex = column.cards.findIndex((c) => c.id === taskId);
      const card = cardIndex !== -1 ? column.cards[cardIndex] : null;

      if (willRecurOnDay && !card && column.date >= todayStr) {
        column.cards.push({
          id: currentTask.value!.id,
          title: currentTask.value!.title,
          description: extractPlainText(currentTask.value!.description as TiptapDoc, 80),
          taskType: currentTask.value!.taskType,
          status: currentTask.value!.status,
          priority: currentTask.value!.priority,
          recurrence_days: newRecurrenceDays ?? [],
          responsible: currentTask.value!.responsible,
          project: currentTask.value!.project,
          story_points: currentTask.value!.story_points,
          completed: false,
        });
      } else if (!willRecurOnDay && card && !card.completed) {
        column.cards.splice(cardIndex, 1);
      }
    }
  };

  const setCardCompleted = (taskId: number, date: string, completed: boolean) => {
    if (!weeklyTasks.value) return;
    for (const column of weeklyTasks.value.columns) {
      if (column.date !== date) continue;
      const cardIndex = column.cards.findIndex((c) => c.id === taskId);
      if (cardIndex === -1) break;
      const card = column.cards[cardIndex];
      if (!completed) {
        const dayOfWeek = new Date(column.date + 'T12:00:00').getDay();
        const isRecurringOnDay = card.recurrence_days?.includes(dayOfWeek) ?? false;
        if (!isRecurringOnDay) {
          column.cards.splice(cardIndex, 1);
          break;
        }
      }
      card.completed = completed;
      break;
    }
  };

  const completeRecurringTask = async (taskId: number, date: string) => {
    setCardCompleted(taskId, date, true);
    if (currentTask.value?.id === taskId) currentTask.value.is_completed_today = true;

    await $fetch(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: { date },
    })
      .then(() => refreshMyTodayTasksCountIfNeeded(date))
      .catch((e) => {
        setCardCompleted(taskId, date, false);
        if (currentTask.value?.id === taskId) currentTask.value.is_completed_today = false;
        throw e;
      });
  };

  const uncompleteRecurringTask = async (taskId: number, date: string) => {
    setCardCompleted(taskId, date, false);
    if (currentTask.value?.id === taskId) currentTask.value.is_completed_today = false;

    await $fetch(`/api/tasks/${taskId}/complete`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: { date },
    })
      .then(() => refreshMyTodayTasksCountIfNeeded(date))
      .catch((e) => {
        setCardCompleted(taskId, date, true);
        if (currentTask.value?.id === taskId) currentTask.value.is_completed_today = true;
        throw e;
      });
  };

  const exportTasks = async (params: ExportTasksParams) => {
    const config = useRuntimeConfig();
    const headers = useRequestHeaders(['cookie']);

    const response = await $fetch<Blob>(`/api/tasks/export`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { ...params, timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone },
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(response);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tasks_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  return {
    tasks,
    fetchTasks,
    sendTimelog,
    swapPriorityTask,
    users,
    labels,
    filter,
    projects,
    createTask,
    duplicateTask,
    startTime,
    timer,
    accumulatedTime,
    currentTask,
    summary,
    openModal,
    endModal,
    fetchTask,
    updateTask,
    deleteTask,
    tasksWithTimelogs,
    fetchTasksWithTimelogs,
    currentTaskId,
    currentTaskDate,
    getKanban,
    loadMoreColumn,
    kanban,
    viewType,
    tasksPageHydrated,
    setColumnCollapsed,
    saveViewType,
    linkExistingTask,
    unlinkTask,
    createAndLinkTask,
    saveFilterState,
    getFilterState,
    isFilterFilled,
    exportTasks,
    weeklyTasks,
    fetchWeeklyTasks,
    refreshWeeklyTasks,
    myTodayTasksCount,
    fetchMyTodayTasksCount,
    applyRecurrenceChangeToWeeklyView,
    completeRecurringTask,
    uncompleteRecurringTask,
  };
});
