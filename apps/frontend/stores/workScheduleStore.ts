import { defineStore } from 'pinia';
import type { WorkSchedule, CreateWorkScheduleDto, UpdateWorkScheduleDto, GetWorkSchedulesParams } from '~/types/work-schedule';
import type { User } from '~/types/user';

export const useWorkScheduleStore = defineStore('work-schedule', () => {
  const config = useRuntimeConfig();
  const schedules = ref<WorkSchedule[]>([]);
  const monthlySchedules = ref<WorkSchedule[]>([]);
  const visibleUsers = ref<User[]>([]);
  const loading = ref(false);

  const fetchSchedules = async (params?: GetWorkSchedulesParams) => {
    loading.value = true;
    try {
      const headers = useRequestHeaders(['cookie']);
      const queryParams = new URLSearchParams();
      if (params?.user_id) queryParams.append('user_id', params.user_id.toString());
      if (params?.start_date) queryParams.append('start_date', params.start_date);
      if (params?.end_date) queryParams.append('end_date', params.end_date);

      const url = `/api/work-schedules${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await $fetch<WorkSchedule[]>(url, {
        baseURL: config.public.API_URL,
        method: 'GET',
        credentials: 'include',
        headers,
      });
      schedules.value = response || [];
      return response;
    } finally {
      loading.value = false;
    }
  };

  const createSchedule = async (data: CreateWorkScheduleDto) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<WorkSchedule>('/api/work-schedules', {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: data,
    });
    if (response) schedules.value.push(response);
    return response;
  };

  const updateSchedule = async (id: number, data: UpdateWorkScheduleDto) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<WorkSchedule>(`/api/work-schedules/${id}`, {
      baseURL: config.public.API_URL,
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: data,
    });
    if (response) {
      const index = schedules.value.findIndex((s) => s.id === id);
      if (index !== -1) schedules.value.splice(index, 1, response);
    }
    return response;
  };

  const fetchMonthlySchedules = async (start_date: string, end_date: string) => {
    const headers = useRequestHeaders(['cookie']);
    const params = new URLSearchParams({ start_date, end_date });
    const response = await $fetch<WorkSchedule[]>(`/api/work-schedules?${params.toString()}`, {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
    });
    monthlySchedules.value = response ?? [];
  };

  const fetchVisibleUsers = async () => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<User[]>('/api/work-schedules/users', {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
    });

    visibleUsers.value = response ?? [];
    return response;
  };

  const deleteSchedule = async (id: number) => {
    const headers = useRequestHeaders(['cookie']);
    await $fetch(`/api/work-schedules/${id}`, {
      baseURL: config.public.API_URL,
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    schedules.value = schedules.value.filter((s) => s.id !== id);
  };

  return {
    schedules,
    monthlySchedules,
    visibleUsers,
    loading,
    fetchSchedules,
    fetchMonthlySchedules,
    fetchVisibleUsers,
    createSchedule,
    updateSchedule,
    deleteSchedule,
  };
});
