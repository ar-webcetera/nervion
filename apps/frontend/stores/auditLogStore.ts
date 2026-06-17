import type { AuditLogItem, AuditLogsFilters, AuditLogsResponse } from '@tracker/contracts';
import { defineStore } from 'pinia';

export const useAuditLogStore = defineStore('audit-log', () => {
  const config = useRuntimeConfig();
  const items = ref<AuditLogItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  const limit = ref(25);
  const pending = ref(false);
  const currentItem = ref<AuditLogItem | null>(null);

  const fetchLogs = async (filters: AuditLogsFilters = {}) => {
    const headers = useRequestHeaders(['cookie']);
    pending.value = true;

    const query = Object.fromEntries(
      Object.entries({
        page: filters.page ?? page.value,
        limit: filters.limit ?? limit.value,
        action_types: filters.action_types?.length ? filters.action_types : undefined,
        entity_types: filters.entity_types?.length ? filters.entity_types : undefined,
        actor_id: filters.actor_id ?? undefined,
        project_id: filters.project_id ?? undefined,
        task_id: filters.task_id ?? undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        search: filters.search?.trim() || undefined,
      }).filter(([, value]) => value !== undefined),
    );

    try {
      const response = await $fetch<AuditLogsResponse>('/api/audit-logs', {
        baseURL: config.public.API_URL,
        credentials: 'include',
        headers,
        query,
      });

      items.value = response.items;
      total.value = response.total;
      page.value = response.page;
      limit.value = response.limit;

      if (currentItem.value) {
        currentItem.value = response.items.find((item) => item.id === currentItem.value?.id) ?? response.items[0] ?? null;
      } else {
        currentItem.value = response.items[0] ?? null;
      }

      return response;
    } finally {
      pending.value = false;
    }
  };

  const selectItem = (item: AuditLogItem | null) => {
    currentItem.value = item;
  };

  return {
    items,
    total,
    page,
    limit,
    pending,
    currentItem,
    fetchLogs,
    selectItem,
  };
});
