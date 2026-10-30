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
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const items = ref<HealthCheck[]>([]);

  const fetchAll = async () => {
    const headers = useApiRequestHeaders();
    items.value = await tenantFetch<HealthCheck[]>('/api/healthchecks', {
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      headers,
    });
  };

  const create = async (dto: CreateHealthCheckDto) => {
    const created = await tenantFetch<HealthCheck>('/api/healthchecks', {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: dto,
    });
    items.value.push(created);
    return created;
  };

  const update = async (id: number, dto: UpdateHealthCheckDto) => {
    const updated = await tenantFetch<HealthCheck>(`/api/healthchecks/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: dto,
    });
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx !== -1) items.value[idx] = updated;
    return updated;
  };

  const toggle = async (id: number) => {
    const updated = await tenantFetch<HealthCheck>(`/api/healthchecks/${id}/toggle`, {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx !== -1) items.value[idx] = updated;
    return updated;
  };

  const remove = async (id: number) => {
    await tenantFetch(`/api/healthchecks/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
    items.value = items.value.filter((i) => i.id !== id);
  };

  return { items, fetchAll, create, update, toggle, remove };
});
