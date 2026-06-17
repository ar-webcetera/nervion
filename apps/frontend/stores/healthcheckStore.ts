import { defineStore } from 'pinia';

export type HealthCheckStatus = 'ok' | 'fail' | 'unknown';

export interface HealthCheck {
  id: number;
  name: string;
  url: string;
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  chat_id: string;
  sender_user_id: number;
  is_active: boolean;
  last_status: HealthCheckStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHealthCheckDto {
  name: string;
  url: string;
  interval_seconds: number;
  timeout_seconds?: number;
  expected_status?: number;
  chat_id: string;
  sender_user_id: number;
}

export interface UpdateHealthCheckDto extends Partial<CreateHealthCheckDto> {
  is_active?: boolean;
}

export const useHealthcheckStore = defineStore('healthcheck', () => {
  const config = useRuntimeConfig();
  const items = ref<HealthCheck[]>([]);

  const fetchAll = async () => {
    const headers = useRequestHeaders(['cookie']);
    items.value = await $fetch<HealthCheck[]>('/api/healthchecks', {
      credentials: 'include',
      baseURL: config.public.API_URL,
      headers,
    });
  };

  const create = async (dto: CreateHealthCheckDto) => {
    const created = await $fetch<HealthCheck>('/api/healthchecks', {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: dto,
    });
    items.value.push(created);
    return created;
  };

  const update = async (id: number, dto: UpdateHealthCheckDto) => {
    const updated = await $fetch<HealthCheck>(`/api/healthchecks/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: dto,
    });
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx !== -1) items.value[idx] = updated;
    return updated;
  };

  const toggle = async (id: number) => {
    const updated = await $fetch<HealthCheck>(`/api/healthchecks/${id}/toggle`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx !== -1) items.value[idx] = updated;
    return updated;
  };

  const remove = async (id: number) => {
    await $fetch(`/api/healthchecks/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
    items.value = items.value.filter((i) => i.id !== id);
  };

  return { items, fetchAll, create, update, toggle, remove };
});
