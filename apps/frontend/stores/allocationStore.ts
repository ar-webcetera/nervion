import { defineStore } from 'pinia';
import type { Allocation, CreateAllocationDto, UpdateAllocationDto, GetAllocationsParams } from '~/types/allocation';

export const useAllocationStore = defineStore('allocation', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const allocations = ref<Allocation[]>([]);
  const loading = ref(false);

  const fetchAllocations = async (params?: GetAllocationsParams) => {
    loading.value = true;
    try {
      const headers = useApiRequestHeaders();
      const queryParams = new URLSearchParams();

      if (params?.user_id) queryParams.append('user_id', params.user_id.toString());
      if (params?.project_id) queryParams.append('project_id', params.project_id.toString());
      if (params?.start_date) queryParams.append('start_date', params.start_date);
      if (params?.end_date) queryParams.append('end_date', params.end_date);

      const url = `/api/allocations${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

      const response = await tenantFetch<Allocation[]>(url, {
        baseURL: tenantApiBaseUrl,
        method: 'GET',
        credentials: 'include',
        headers,
      });

      allocations.value = response || [];
      return response;
    } finally {
      loading.value = false;
    }
  };

  const createAllocation = async (data: CreateAllocationDto) => {
    const headers = useApiRequestHeaders();
    const response = await tenantFetch<Allocation>('/api/allocations', {
      baseURL: tenantApiBaseUrl,
      method: 'POST',
      credentials: 'include',
      headers,
      body: data,
    });

    if (response) {
      allocations.value.push(response);
    }

    return response;
  };

  const updateAllocation = async (id: number, data: UpdateAllocationDto) => {
    const headers = useApiRequestHeaders();
    const response = await tenantFetch<Allocation>(`/api/allocations/${id}`, {
      baseURL: tenantApiBaseUrl,
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: data,
    });

    if (response) {
      const index = allocations.value.findIndex((a) => a.id === id);
      if (index !== -1) {
        allocations.value.splice(index, 1, response);
      }
    }

    return response;
  };

  const deleteAllocation = async (id: number) => {
    const headers = useApiRequestHeaders();
    await tenantFetch(`/api/allocations/${id}`, {
      baseURL: tenantApiBaseUrl,
      method: 'DELETE',
      credentials: 'include',
      headers,
    });

    allocations.value = allocations.value.filter((a) => a.id !== id);
  };

  return {
    allocations,
    loading,
    fetchAllocations,
    createAllocation,
    updateAllocation,
    deleteAllocation,
  };
});
