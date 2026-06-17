import type BaseModal from '~/components/BaseModal.vue';
import type { Timelog } from '~/types/task';

export const useTaskModals = (
  deleteComment: (id: number | null, commentId: number | null) => Promise<boolean>,
  deleteComments: () => Promise<boolean>,
  fixNewTimelog: (timelog: Partial<Timelog>) => Promise<Timelog | undefined>,
  deleteTask: () => Promise<void>,
  duplicateTask: () => Promise<unknown>,
  emit: (event: 'close') => void,
) => {
  const modalRefs = {
    deleteTask: ref<InstanceType<typeof BaseModal> | null>(null),
    duplicateTask: ref<InstanceType<typeof BaseModal> | null>(null),
    deleteComment: ref<InstanceType<typeof BaseModal> | null>(null),
    deleteComments: ref<InstanceType<typeof BaseModal> | null>(null),
    fixTimelog: ref<InstanceType<typeof BaseModal> | null>(null),
  };
  const idDeleteComment = ref<number | null>(null);
  const idDeleteThreadComment = ref<number | null>(null);
  const isDuplicating = ref(false);

  const openModal = (key: keyof typeof modalRefs) => {
    modalRefs[key].value?.open();
  };

  const closeModal = (key: keyof typeof modalRefs) => {
    modalRefs[key].value?.close();
  };

  const openDeleteTaskModal = () => {
    openModal('deleteTask');
  };

  const openDuplicateTaskModal = () => {
    openModal('duplicateTask');
  };

  const closeDuplicateTaskModal = () => {
    closeModal('duplicateTask');
  };

  const openDeleteCommentModal = (id: number, commentId?: number | null) => {
    idDeleteThreadComment.value = null;
    idDeleteComment.value = id;
    if (commentId) {
      idDeleteThreadComment.value = commentId;
    }
    openModal('deleteComment');
  };

  const openDeleteCommentsModal = () => {
    openModal('deleteComments');
  };

  const openFixTimelogModal = () => {
    openModal('fixTimelog');
  };

  const closeDeleteTaskModal = () => {
    closeModal('deleteTask');
  };

  const closeDeleteCommentModal = () => {
    idDeleteComment.value = null;
    idDeleteThreadComment.value = null;
    closeModal('deleteComment');
  };

  const closeDeleteCommentsModal = () => {
    closeModal('deleteComments');
  };

  const closeFixTimelogModal = () => {
    closeModal('fixTimelog');
  };

  const handleDeleteComment = async () => {
    const success = await deleteComment(idDeleteComment.value, idDeleteThreadComment.value);
    if (success) {
      closeDeleteCommentModal();
    }
  };

  const handleDeleteTask = async () => {
    await deleteTask();
    closeDeleteTaskModal();
    emit('close');
  };

  const handleDuplicateTask = async () => {
    if (isDuplicating.value) return;
    isDuplicating.value = true;
    try {
      await duplicateTask();
      closeDuplicateTaskModal();
    } finally {
      isDuplicating.value = false;
    }
  };

  const handleFixNewTimelog = async (timelog: Partial<Timelog>) => {
    const response = await fixNewTimelog(timelog);
    if (response) {
      closeFixTimelogModal();
    }
  };

  const handleDeleteComments = async () => {
    const success = await deleteComments();
    if (success) {
      closeDeleteCommentsModal();
    }
  };

  return {
    modalRefs,
    idDeleteComment,
    idDeleteThreadComment,
    openDeleteCommentModal,
    openDeleteCommentsModal,
    openDeleteTaskModal,
    openDuplicateTaskModal,
    closeDuplicateTaskModal,
    isDuplicating,
    openFixTimelogModal,
    closeDeleteCommentModal,
    closeDeleteCommentsModal,
    closeDeleteTaskModal,
    closeFixTimelogModal,
    handleDeleteComment,
    handleDeleteTask,
    handleDuplicateTask,
    handleFixNewTimelog,
    handleDeleteComments,
  };
};
