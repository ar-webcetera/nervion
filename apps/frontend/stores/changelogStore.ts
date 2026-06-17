import { defineStore } from 'pinia';
import type { JSONContent } from '@tiptap/core';

export interface Changelog {
  id: number;
  title: string;
  body: JSONContent | null;
  is_published: boolean;
  author_id: number | null;
  created_at: string;
  updated_at: string;
  views_count?: number;
}

export const useChangelogStore = defineStore('changelog', () => {
  const config = useRuntimeConfig();

  const unseen = ref<Changelog[]>([]);
  const all = ref<Changelog[]>([]);

  const fetchUnseen = async () => {
    const headers = useRequestHeaders(['cookie']);
    const data = await $fetch<Changelog[]>('/api/changelogs/unseen', {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
    });
    unseen.value = data;
  };

  const fetchAll = async () => {
    const headers = useRequestHeaders(['cookie']);
    const data = await $fetch<Changelog[]>('/api/changelogs', {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
    });
    all.value = data;
  };

  const markViewed = async (id: number) => {
    await $fetch(`/api/changelogs/${id}/view`, {
      method: 'POST',
      baseURL: config.public.API_URL,
      credentials: 'include',
    });
    unseen.value = unseen.value.filter((c) => c.id !== id);
  };

  const create = async (dto: { title: string; body: JSONContent | null; is_published: boolean }) => {
    const data = await $fetch<Changelog>('/api/changelogs', {
      method: 'POST',
      baseURL: config.public.API_URL,
      credentials: 'include',
      body: dto,
    });
    all.value.unshift(data);
    return data;
  };

  const update = async (id: number, dto: Partial<{ title: string; body: JSONContent | null; is_published: boolean }>) => {
    const data = await $fetch<Changelog>(`/api/changelogs/${id}`, {
      method: 'PATCH',
      baseURL: config.public.API_URL,
      credentials: 'include',
      body: dto,
    });
    const idx = all.value.findIndex((c) => c.id === id);
    if (idx !== -1) all.value[idx] = { ...all.value[idx], ...dto, id };
    return data;
  };

  const remove = async (id: number) => {
    await $fetch(`/api/changelogs/${id}`, {
      method: 'DELETE',
      baseURL: config.public.API_URL,
      credentials: 'include',
    });
    all.value = all.value.filter((c) => c.id !== id);
  };

  return { unseen, all, fetchUnseen, fetchAll, markViewed, create, update, remove };
});
