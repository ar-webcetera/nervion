import { defineStore } from 'pinia';
import type { QuickLink, CreateQuickLinkDto, UpdateQuickLinkDto } from '~/types/quick-link';

export const useQuickLinkStore = defineStore('quickLink', () => {
  const config = useRuntimeConfig();
  const quickLinks = ref<QuickLink[]>([]);

  const fetchQuickLinks = async (projectId: number) => {
    try {
      const cookies = useRequestHeaders(['cookie']);
      const data = await $fetch<QuickLink[]>('/api/quick-links', {
        credentials: 'include',
        baseURL: config.public.API_URL,
        method: 'GET',
        params: { project_id: projectId },
        headers: {
          ...cookies,
        },
      });
      quickLinks.value = data;
      return data;
    } catch (error) {
      console.error('Ошибка при загрузке быстрых ссылок:', error);
      throw error;
    }
  };

  const createQuickLink = async (dto: CreateQuickLinkDto) => {
    try {
      const data = await $fetch<QuickLink>('/api/quick-links', {
        baseURL: config.public.API_URL,
        credentials: 'include',
        method: 'POST',
        body: dto,
      });
      quickLinks.value.push(data);
      return data;
    } catch (error) {
      console.error('Ошибка при создании быстрой ссылки:', error);
      throw error;
    }
  };

  const updateQuickLink = async (id: number, dto: UpdateQuickLinkDto) => {
    try {
      const data = await $fetch<QuickLink>(`/api/quick-links/${id}`, {
        baseURL: config.public.API_URL,
        credentials: 'include',
        method: 'PATCH',
        body: dto,
      });
      const index = quickLinks.value.findIndex((link) => link.id === id);
      if (index !== -1) {
        quickLinks.value[index] = data;
      }
      return data;
    } catch (error) {
      console.error('Ошибка при обновлении быстрой ссылки:', error);
      throw error;
    }
  };

  const deleteQuickLink = async (id: number) => {
    try {
      await $fetch(`/api/quick-links/${id}`, {
        baseURL: config.public.API_URL,
        credentials: 'include',
        method: 'DELETE',
      });
      quickLinks.value = quickLinks.value.filter((link) => link.id !== id);
    } catch (error) {
      console.error('Ошибка при удалении быстрой ссылки:', error);
      throw error;
    }
  };

  return {
    quickLinks,
    fetchQuickLinks,
    createQuickLink,
    updateQuickLink,
    deleteQuickLink,
  };
});
