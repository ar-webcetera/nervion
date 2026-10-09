import type { JSONContent } from '@tiptap/core';
import { defineStore } from 'pinia';

export interface ParsedTask {
  title: string;
  description: JSONContent;
}

export const useAiStore = defineStore('ai', () => {
  const config = useRuntimeConfig();
  const parseTextToTask = async (text: string, instruction?: string, images: File[] = []) => {
    if (images.length > 0) {
      const body = new FormData();
      body.append('text', text);
      if (instruction) body.append('instruction', instruction);
      images.forEach((image) => body.append('images', image));

      return await $fetch<ParsedTask>('/api/deepseek/parse-text-to-task', {
        baseURL: config.public.API_URL,
        method: 'POST',
        body,
        credentials: 'include',
        timeout: 95000,
      });
    }

    const response = await $fetch<ParsedTask>('/api/deepseek/parse-text-to-task', {
      baseURL: config.public.API_URL,
      method: 'POST',
      body: { text, ...(instruction ? { instruction } : {}) },
      credentials: 'include',
      timeout: 65000,
    });

    return response;
  };

  return {
    parseTextToTask,
  };
});
