import { defineStore } from 'pinia';

export interface ApiToken {
  id: number;
  name: string;
  last_used_at: string | null;
  expires_at: string | null;
  createdAt: string;
}

export const useApiTokenStore = defineStore('apiToken', () => {
  const config = useRuntimeConfig();
  const tokens = ref<ApiToken[]>([]);
  const newToken = ref<string | null>(null);

  const fetchTokens = async () => {
    tokens.value = await $fetch<ApiToken[]>('/api/api-tokens', {
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
  };

  const createToken = async (name: string) => {
    const res = await $fetch<{ token: string; record: ApiToken }>('/api/api-tokens', {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body: { name },
    });
    newToken.value = res.token;
    tokens.value.unshift(res.record);
  };

  const deleteToken = async (id: number) => {
    await $fetch(`/api/api-tokens/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
    tokens.value = tokens.value.filter((t) => t.id !== id);
  };

  const clearNewToken = () => {
    newToken.value = null;
  };

  return { tokens, newToken, fetchTokens, createToken, deleteToken, clearNewToken };
});
