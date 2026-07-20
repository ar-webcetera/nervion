import { defineStore } from 'pinia';
import type { User } from '~/types/user';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  const users = ref<User[]>([]);

  const usersOptions = computed(() => {
    return users.value.length ? users.value.map((user: User) => user) : [];
  });

  const fetchUsersWidthCostByProject = async (groupId: string) => {
    const headers = useRequestHeaders(['cookie']);
    const { data } = await useFetch<User[]>(`/api/users/project/${encodeURIComponent(groupId)}`, {
      baseURL: useApiBaseUrl(),
      method: 'GET',
      credentials: 'include',
      headers,
    });
    return data.value;
  };

  const fetchUsers = async () => {
    const headers = useRequestHeaders(['cookie']);

    const response = await $fetch<User[]>('/api/users', {
      baseURL: useApiBaseUrl(),
      method: 'GET',
      credentials: 'include',
      headers,
    });
    users.value = response || [];
  };

  const fetchMe = async () => {
    const { data } = await useFetch<User>(`/api/auth/me`, {
      baseURL: useApiBaseUrl(),
      method: 'GET',
      credentials: 'include',
    });
    user.value = data.value;
    return data.value;
  };

  const createUser = async (user: User) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<User>(`/api/users`, {
      baseURL: useApiBaseUrl(),
      method: 'POST',
      credentials: 'include',
      headers,
      body: user,
    });
    users.value.push(response);
    return response;
  };

  const updateUser = async (user: User, userId: number) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<User>(`/api/users/${userId}`, {
      baseURL: useApiBaseUrl(),
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: user,
    });
    users.value = users.value.map((u) => {
      if (u.id === userId) return response;
      return u;
    });
    return response;
  };

  const updateMenuSettings = async (hiddenMenuItems: string[]) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<{ hidden_menu_items: string[] }>('/api/users/menu-settings', {
      baseURL: useApiBaseUrl(),
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: { hidden_menu_items: hiddenMenuItems },
    });
    if (user.value) {
      user.value.hidden_menu_items = response.hidden_menu_items;
    }
    return response;
  };

  const onlineUserIds = ref<Set<number>>(new Set());

  const archivedUsers = ref<User[]>([]);

  const fetchArchivedUsers = async () => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<User[]>('/api/users/archived', {
      baseURL: useApiBaseUrl(),
      method: 'GET',
      credentials: 'include',
      headers,
    });
    archivedUsers.value = response || [];
  };

  const archiveUser = async (id: number) => {
    const headers = useRequestHeaders(['cookie']);
    await $fetch(`/api/users/${id}`, {
      baseURL: useApiBaseUrl(),
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    const archived = users.value.find((u) => u.id === id);
    users.value = users.value.filter((u) => u.id !== id);
    if (archived) archivedUsers.value.unshift(archived);
  };

  const restoreUser = async (id: number) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<User>(`/api/users/${id}/restore`, {
      baseURL: useApiBaseUrl(),
      method: 'PATCH',
      credentials: 'include',
      headers,
    });
    archivedUsers.value = archivedUsers.value.filter((u) => u.id !== id);
    if (response) users.value.push(response);
  };

  return {
    fetchUsersWidthCostByProject,
    user,
    fetchMe,
    fetchUsers,
    users,
    usersOptions,
    createUser,
    updateUser,
    updateMenuSettings,
    onlineUserIds,
    archivedUsers,
    fetchArchivedUsers,
    archiveUser,
    restoreUser,
  };
});
