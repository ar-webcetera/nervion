import { defineStore } from 'pinia';
import type { WikiPage, WikiTreeNode } from '~/types/wiki';
import type { JSONContent } from '@tiptap/core';

interface UpdatePageOptions {
  name?: string;
  parent_page_id?: number | null;
  priority?: number;
  description?: JSONContent;
}

export const useWikiStore = defineStore('wiki', () => {
  const config = useRuntimeConfig();
  const isEditable = ref<boolean>(false);
  const isLoading = ref<boolean>(false);
  const files = ref<{ Key: string; name: string }[]>([]);
  const currentPage = ref<WikiPage | null>(null);
  const wikiTree = ref<WikiTreeNode[]>([]);
  const selectedProjectId = ref<number | null>(null);

  const fetchPages = async (projectId: number) => {
    const headers = useRequestHeaders(['cookie']);
    const id = { project_id: projectId };

    const data = await $fetch<WikiTreeNode[]>(`/api/wiki-pages/project/${projectId}`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params: id,
    });
    wikiTree.value = data || [];
    return data;
  };

  const fetchPage = async (pageId: number) => {
    const headers = useRequestHeaders(['cookie']);
    isLoading.value = true;
    try {
      const page = await $fetch<WikiPage>(`/api/wiki-pages/${pageId}`, {
        baseURL: config.public.API_URL,
        method: 'GET',
        credentials: 'include',
        headers,
      });
      currentPage.value = page;
      return page;
    } finally {
      isLoading.value = false;
    }
  };

  const updatePage = async (id: number, updatePageOptions: UpdatePageOptions = {}) => {
    const body: Partial<WikiPage> = {};
    if (updatePageOptions.name) body.name = updatePageOptions.name;
    if (updatePageOptions.parent_page_id || updatePageOptions.parent_page_id === null)
      body.parent_page_id = updatePageOptions.parent_page_id;
    if (updatePageOptions.priority) body.priority = updatePageOptions.priority;
    if (updatePageOptions.description) body.description = updatePageOptions.description;
    await $fetch(`/api/wiki-pages/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
  };

  const createPage = async (pageInfo: Partial<WikiPage>) => {
    const body: Partial<WikiPage> = {};
    if (pageInfo.name) body.name = pageInfo.name;
    if (pageInfo.project_id) body.project_id = Number(pageInfo.project_id);
    if (pageInfo.parent_page_id || pageInfo.parent_page_id === null) body.parent_page_id = pageInfo.parent_page_id;
    if (pageInfo.priority) body.priority = pageInfo.priority;
    const page = await $fetch<WikiPage>(`/api/wiki-pages/`, {
      method: 'POST',
      credentials: 'include',
      baseURL: config.public.API_URL,
      body,
    });
    return page;
  };

  const deletePage = async (pageId: number) => {
    await $fetch(`/api/wiki-pages/${pageId}`, {
      method: 'DELETE',
      credentials: 'include',
      baseURL: config.public.API_URL,
    });
  };

  const reset = () => {
    wikiTree.value = [];
    currentPage.value = null;
  };

  return {
    isEditable,
    isLoading,
    files,
    fetchPages,
    fetchPage,
    currentPage,
    updatePage,
    deletePage,
    createPage,
    wikiTree,
    selectedProjectId,
    reset,
  };
});
