import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Timelog } from '~/types/task';

export const useTimelogStore = defineStore('timelog', () => {
  const config = useRuntimeConfig();
  const totalTimeSpent = ref<string | null>(null);
  const timelogs = ref<Timelog[]>([]);
  const currentTimelogs = ref<Timelog[]>([]);

  const createTimelog = async (params: Partial<Timelog>) => {
    const ev = await $fetch<Timelog>(`/api/timelogs/`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: params,
    });
    return ev;
  };

  const findTimelogsByTask = async (task_id: number) => {
    const response = await $fetch<{ totalTimeSpent: string; timelogs: Timelog[] }>(`/api/timelogs/tasks/${task_id}/`, {
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
    if (response.totalTimeSpent) {
      totalTimeSpent.value = response.totalTimeSpent;
    }
    timelogs.value = response.timelogs;
    return response;
  };

  const findByFilter = async (params: Partial<Timelog>) => {
    const response = await $fetch<Timelog[]>(`/api/timelogs/`, {
      credentials: 'include',
      baseURL: config.public.API_URL,
      params,
    });
    return response;
  };

  const deleteTimelog = async (id: number) => {
    await $fetch<Timelog>(`/api/timelogs/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
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

    const ev = await $fetch<Timelog>(`/api/timelogs/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
    return ev;
  };

  return {
    currentTimelogs,
    timelogs,
    createTimelog,
    deleteTimelog,
    updateTimelog,
    findByFilter,
    totalTimeSpent,
    findTimelogsByTask,
  };
});
