import type { JSONContent } from '@tiptap/core';
import { defineStore } from 'pinia';

export interface ParsedTask {
  title: string;
  description: JSONContent;
}

export const useAiStore = defineStore('ai', () => {
  const config = useRuntimeConfig();
  const parseTextToTask = async (text: string, instruction?: string) => {
    const response = await $fetch<ParsedTask>('/api/deepseek/parse-text-to-task', {
      baseURL: config.public.API_URL,
      method: 'POST',
      body: { text, ...(instruction ? { instruction } : {}) },
      timeout: 65000,
    });

    return response;
  };

  return {
    parseTextToTask,
  };
});
