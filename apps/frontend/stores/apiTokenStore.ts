import { defineStore } from 'pinia';

export interface ApiToken {
  id: number;
  name: string;
  last_used_at: string | null;
  expires_at: string | null;
  createdAt: string;
}

export const useApiTokenStore = defineStore('apiToken', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const tokens = ref<ApiToken[]>([]);
  const newToken = ref<string | null>(null);

  const fetchTokens = async () => {
    tokens.value = await tenantFetch<ApiToken[]>('/api/api-tokens', {
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
  };

  const createToken = async (name: string) => {
    const res = await tenantFetch<{ token: string; record: ApiToken }>('/api/api-tokens', {
      method: 'POST',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
      body: { name },
    });
    newToken.value = res.token;
    tokens.value.unshift(res.record);
  };

  const deleteToken = async (id: number) => {
    await tenantFetch(`/api/api-tokens/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: tenantApiBaseUrl,
    });
    tokens.value = tokens.value.filter((t) => t.id !== id);
  };

  const clearNewToken = () => {
    newToken.value = null;
  };

  return { tokens, newToken, fetchTokens, createToken, deleteToken, clearNewToken };
});
