import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Timelog } from '~/types/task';

export const useTimelogStore = defineStore('timelog', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const totalTimeSpent = ref<string | null>(null);
  const timelogs = ref<Timelog[]>([]);
  const currentTimelogs = ref<Timelog[]>([]);

  const createTimelog = async (params: Partial<Timelog>) => {
    const ev = await tenantFetch<Timelog>(`/api/timelogs/`, {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: params,
    });
    return ev;
  };

  /**
   * Кладёт таймлог в список активных без дублей: тот же таймлог параллельно
   * приходит через websocket-событие `timelog_updated`.
   */
  const upsertCurrentTimelog = (timelog: Timelog, prepend = false) => {
    const others = currentTimelogs.value.filter((t) => t.id !== timelog.id);
    currentTimelogs.value = prepend ? [timelog, ...others] : [...others, timelog];
  };

  const findTimelogsByTask = async (task_id: number) => {
    const response = await tenantFetch<{ totalTimeSpent: string; timelogs: Timelog[] }>(`/api/timelogs/tasks/${task_id}/`, {
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
    if (response.totalTimeSpent) {
      totalTimeSpent.value = response.totalTimeSpent;
    }
    timelogs.value = response.timelogs;
    return response;
  };

  const findByFilter = async (params: Partial<Timelog>) => {
    const response = await tenantFetch<Timelog[]>(`/api/timelogs/`, {
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      params,
    });
    return response;
  };

  const deleteTimelog = async (id: number) => {
    await tenantFetch<Timelog>(`/api/timelogs/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
  };
  const updateTimelog = async (
    id: number,
    { status, summary, task_id, title }: Partial<Timelog> & { task_id?: number | null; title?: string },
  ) => {
    const body: Record<string, unknown> = {};
    if (status) body.status = status;
    if (summary !== undefined) body.summary = summary;
    if (task_id !== undefined) body.task_id = task_id;
    if (title !== undefined) body.title = title;

    const ev = await tenantFetch<Timelog>(`/api/timelogs/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body,
    });
    return ev;
  };

  return {
    currentTimelogs,
    upsertCurrentTimelog,
    timelogs,
    createTimelog,
    deleteTimelog,
    updateTimelog,
    findByFilter,
    totalTimeSpent,
    findTimelogsByTask,
  };
});
