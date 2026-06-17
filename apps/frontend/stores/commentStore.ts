import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Comment } from '~/types/comment';
import type { JSONContent } from '@tiptap/core';
import { TypeSort } from '~/constants/sort.constants';

export const useCommentStore = defineStore('comment', () => {
  const config = useRuntimeConfig();
  const comments = ref<Comment[]>([]);
  const currentComment = ref<Comment | null>(null);
  const sortType = ref<TypeSort>(TypeSort.ASC);
  const sortTypeCookie = useCookie<TypeSort>('sort-type', {
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
  });

  interface CommentParams {
    message?: JSONContent;
    author_id?: number;
    task_id?: number;
    comment_id?: number | null;
  }

  const getSortType = () => {
    if (sortTypeCookie.value === TypeSort.DESC) {
      return TypeSort.DESC;
    }
    return TypeSort.ASC;
  };

  const setSortType = (type: TypeSort = TypeSort.ASC) => {
    sortTypeCookie.value = type;
  };

  const getCommentById = (id: number) => {
    for (const comment of comments.value) {
      if (comment.subComments.length) {
        const subComment = comment.subComments.find((sub) => sub.id === id);
        if (subComment) return subComment;
      }
      if (comment.id === id) return comment;
    }
    return null;
  };

  const fetchComments = async (task_id: number) => {
    const headers = useRequestHeaders(['cookie']);
    const params: { task_id: number; sort?: string } = { task_id: task_id };
    if (sortType.value) params.sort = sortType.value;

    const response = await $fetch<Comment[]>(`/api/comments/`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      params,
    });
    comments.value = response || [];
  };

  const updateComment = async (id: number, message: object) => {
    const headers = useRequestHeaders(['cookie']);

    await $fetch(`/api/comments/${id}`, {
      baseURL: config.public.API_URL,
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: message,
    });
  };

  const deleteComment = async (id: number) => {
    await $fetch(`/api/comments/${id}`, {
      baseURL: config.public.API_URL,
      method: 'DELETE',
      credentials: 'include',
    });
  };

  const deleteComments = async (task_id: number) => {
    await $fetch(`/api/tasks/${task_id}/comments/`, {
      baseURL: config.public.API_URL,
      method: 'DELETE',
      credentials: 'include',
    });
  };

  const createComment = async ({ message, author_id, task_id, comment_id }: CommentParams) => {
    const headers = useRequestHeaders(['cookie']);

    return await $fetch<Comment>(`/api/comments/`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { task_id, message, author_id, comment_id },
    });
  };

  return {
    currentComment,
    fetchComments,
    comments,
    createComment,
    updateComment,
    deleteComment,
    deleteComments,
    sortType,
    getSortType,
    setSortType,
    getCommentById,
  };
});
