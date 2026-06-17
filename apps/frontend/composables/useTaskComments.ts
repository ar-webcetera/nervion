import type { JSONContent } from '@tiptap/core';
import { getErrorMessage } from '~/utils/error';
import { hasTiptapContent } from '~/utils/tiptap/content';

export const useTaskComments = (taskId: Ref<number | null>) => {
  const commentStore = useCommentStore();
  const userStore = useUserStore();
  const { $toast } = useNuxtApp();

  const commentsPending = ref(true);
  const idDeleteComment = ref<number | null>(null);
  const idDeleteThreadComment = ref<number | null>(null);

  const newComments = ref({
    message: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
        },
      ],
    },
  });

  const fetchComments = async () => {
    commentsPending.value = true;

    try {
      if (!taskId.value) return;
      await commentStore.fetchComments(taskId.value);
    } catch (e) {
      $toast.error(getErrorMessage(e));
    } finally {
      commentsPending.value = false;
    }
  };

  const createComment = async (value: JSONContent, commentId: number | null = null) => {
    try {
      if (!userStore.user?.id || !taskId.value) return false;
      if (!hasTiptapContent(value)) return false;
      const message = value;

      await commentStore.createComment({
        task_id: taskId.value,
        message,
        author_id: userStore.user.id,
        comment_id: commentId,
      });

      newComments.value.message = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      };
      return true;
    } catch (e) {
      $toast.error(getErrorMessage(e));
      return false;
    }
  };

  const saveComment = (id: number, body: object) => {
    const taskStore = useTaskStore();
    body = { task_id: taskStore.currentTaskId, ...body };
    commentStore.updateComment(id, body);
  };

  const deleteComment = async (id: number | null, commentId: number | null): Promise<boolean> => {
    try {
      if (!id) return false;
      await commentStore.deleteComment(id);

      if (commentId) {
        const parentComment = commentStore.comments.find((c) => c.id === commentId);
        if (parentComment?.subComments) {
          parentComment.subComments = parentComment.subComments.filter((c) => c.id !== id);
        }
      } else {
        commentStore.comments = commentStore.comments.filter((c) => c.id !== id);
      }
      return true;
    } catch (e) {
      $toast.error(getErrorMessage(e));
      return false;
    }
  };

  const deleteComments = async () => {
    try {
      if (!taskId.value) return false;
      await commentStore.deleteComments(taskId.value);
      commentStore.comments = [];
      return true;
    } catch (e) {
      $toast.error(getErrorMessage(e));
      return false;
    }
  };

  return {
    commentsPending,
    idDeleteComment,
    idDeleteThreadComment,
    newComments,
    fetchComments,
    createComment,
    saveComment,
    deleteComment,
    deleteComments,
  };
};
