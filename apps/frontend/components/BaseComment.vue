<script setup lang="ts">
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import type { Comment } from '~/types/comment';
import { format } from 'date-fns';
import IconThread from '~/components/Icons/IconThread.vue';
import IconArrowRight from '~/components/Icons/IconArrowRight.vue';
import type { JSONContent } from '@tiptap/core';
import IconCheck from './Icons/IconCheck.vue';
import IconPen from './Icons/IconPen.vue';
import IconTrash from './Icons/IconTrash.vue';
import { hasTiptapContent } from '~/utils/tiptap/content';
import { useNotificationStore } from '~/stores/notificationStore';
import type { Notification } from '~/types/notification';

defineOptions({ name: 'BaseComment' });

const props = defineProps<{
  comment: Comment;
  currentTaskId: number | null;
  userId: number;
}>();
const emit = defineEmits<{
  (e: 'save-comment', id: number, body: object): void;
  (e: 'delete-comment', id: number, commentId?: number): void;
  (e: 'create-comment', taskId: number | null, value: JSONContent, commentId: number): void;
}>();

const comment = ref(props.comment);
const messageCopy = ref(props.comment.message);
const isEditableComment = ref(false);
const isOpenNewThread = ref(false);
const threadEditorRef = ref<{ focusEditor: () => void; clearContent: () => void } | null>(null);
const notificationStore = useNotificationStore();

const newComments = ref({
  message: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [],
      },
    ],
  },
});

const editComment = () => {
  isEditableComment.value = true;
};

const isThreadComment = computed(() => {
  return !!props.comment.comment_id;
});

const isExistSubComments = computed(() => {
  return !!props.comment.subComments?.length;
});

const deleteComment = (id?: number) => {
  if (id) {
    emit('delete-comment', id, props.comment.id);
  } else {
    emit('delete-comment', props.comment.id);
  }
};

const cancelEdit = () => {
  comment.value.message = messageCopy.value;
  isEditableComment.value = false;
};

const getCommentTime = computed(() => {
  return format(comment.value.created_at, 'dd.MM.yy ⋅ HH:mm');
});

const saveEdit = (threadId?: number, threadMessage?: JSONContent) => {
  if (threadId && threadMessage) {
    emit('save-comment', threadId, threadMessage);
  } else {
    const body = {
      author_id: props.comment.author?.id,
      message: comment.value.message,
    };
    emit('save-comment', props.comment.id, body);
    messageCopy.value = comment.value.message;
  }
  isEditableComment.value = false;
};

const createComment = (taskId: number | null, value: JSONContent, threadId: number) => {
  if (!props.userId || !taskId) return;
  emit('create-comment', taskId, value, threadId);
  threadEditorRef.value?.clearContent();
  threadEditorRef.value?.focusEditor();
};

const openNewThread = () => {
  comment.value.isOpenThread = true;
  isOpenNewThread.value = true;
};

const closeNewThread = () => {
  newComments.value.message = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [],
      },
    ],
  };
  comment.value.isOpenThread = false;
  isOpenNewThread.value = false;
};

const toggleThread = () => {
  comment.value.isOpenThread = !comment.value.isOpenThread;
};

const toggleResolve = () => {
  comment.value.isOpenThread = false;
  comment.value.resolved = !comment.value.resolved;
  const body = {
    resolved: comment.value.resolved,
  };
  emit('save-comment', props.comment.id, body);
};

const root = ref<HTMLElement | null>(null);
const isVisible = ref(false);
let observer: IntersectionObserver | null = null;
let notificationMarked = false;
let notificationMarkInFlight = false;

const getLinkParam = (link: string, param: string): string | null => {
  try {
    return new URL(link, 'http://localhost').searchParams.get(param);
  } catch {
    return null;
  }
};

const isCurrentCommentNotification = (notification: Notification): boolean => {
  const commentId = getLinkParam(notification.link, 'comment-id');
  const taskId = getLinkParam(notification.link, 'task-id');

  return commentId === String(props.comment.id) && taskId === String(props.currentTaskId);
};

const markNotificationAsRead = async () => {
  if (notificationMarked || notificationMarkInFlight || !isVisible.value) return;

  const notifications = notificationStore.notifications.filter(
    (notification) => !notification.is_read && isCurrentCommentNotification(notification),
  );
  if (!notifications.length) return;

  notificationMarkInFlight = true;
  try {
    await Promise.all(
      notifications.map((notification) => notificationStore.updateNotifications(notification.id, { is_read: true })),
    );
    notificationMarked = true;
    observer?.disconnect();
  } catch (e) {
    console.error('Ошибка при отметке уведомления как прочитанного:', e);
  } finally {
    notificationMarkInFlight = false;
  }
};

watch(
  () =>
    notificationStore.notifications
      .filter((notification) => !notification.is_read && isCurrentCommentNotification(notification))
      .map((notification) => notification.id)
      .join(','),
  () => {
    void markNotificationAsRead();
  },
);

onMounted(() => {
  if (!root.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isVisible.value = entry.isIntersecting;
        if (entry.isIntersecting) void markNotificationAsRead();
      });
    },
    {
      threshold: 0,
    },
  );

  observer.observe(root.value);
});

onUnmounted(() => {
  observer?.disconnect();
});
</script>

<template>
  <div class="base-comment__wrapper">
    <div
      ref="root"
      :data-comment="comment.id"
      :class="[
        'base-comment',
        {
          'base-comment_thread': isThreadComment,
          'base-comment_active': userId === props.comment.author?.id,
          'base-comment_with-thread': isExistSubComments || comment.isOpenThread,
          'base-comment_resolved': comment.resolved,
        },
      ]"
    >
      <div :class="['base-comment__left', { 'base-comment__left_with-thread': isExistSubComments }]">
        <div class="base-comment__user">
          <div class="base-comment__user-logo">
            <img v-if="comment.author?.photo_url" :src="comment.author?.photo_url" alt="" @error="($event.target as HTMLImageElement).style.display='none'" />
            <span v-else>{{ useShortName(comment.author!) }}</span>
          </div>
        </div>
      </div>
      <div class="base-comment__right">
        <div class="base-comment__header">
          <div class="base-comment__user">
            <span>{{ useFullName(comment.author!) }}</span>
            <div class="base-comment__time">{{ getCommentTime }}</div>
          </div>
          <div class="base-comment__tools">
            <IconThread v-if="!isOpenNewThread && !isExistSubComments && !isThreadComment" @click="openNewThread" />
            <div
              v-if="!isThreadComment"
              :class="['base-comment__resolve', { 'base-comment__resolve_active': comment.resolved }]"
              @click="toggleResolve"
            >
              <IconCheck />
            </div>
            <IconPen class="base-comment__pen" @click="editComment" />
            <IconTrash class="base-comment__trash" @click="deleteComment()" />
          </div>
        </div>
        <div class="base-comment__message">
          <EditorTiptap
            :key="String(isEditableComment)"
            v-model="comment.message"
            :is-editable="isEditableComment"
            :value="comment.message"
          />
        </div>
        <div v-if="isEditableComment" class="base-comment__buttons base-comment__buttons_edit">
          <button class="button button_secondary" @click="cancelEdit">Отменить</button>
          <button :disabled="!hasTiptapContent(comment.message)" @click="saveEdit()">Сохранить</button>
        </div>
        <div
          v-if="isExistSubComments || comment.isOpenThread"
          :class="[
            'base-comment__thread',
            { 'base-comment__thread_resolved': comment.resolved, 'base-comment__thread_closed': !comment.isOpenThread },
          ]"
        >
          <div v-if="comment.isOpenThread" class="base-comment__thread-list">
            <div v-if="isExistSubComments" class="base-comment__thread-body">
              <BaseComment
                v-for="subComment of comment.subComments"
                :key="subComment.id"
                :user-id="userId"
                :comment="subComment"
                :comment-id="comment.id"
                :current-task-id="currentTaskId"
                @save-comment="saveEdit"
                @delete-comment="deleteComment"
              />
            </div>
            <div class="base-comment__form">
              <div class="base-comment__input">
                <EditorTiptap
                  ref="threadEditorRef"
                  v-model="newComments.message"
                  placeholder="Напишите коментарий..."
                  :is-editable="true"
                  :value="newComments.message"
                  @enter="createComment(currentTaskId, newComments.message, comment.id)"
                />
              </div>
              <div class="base-comment__buttons">
                <button v-if="!isExistSubComments" class="button button_secondary" @click="closeNewThread">Отменить</button>
                <button
                  class="button button_primary"
                  :disabled="!hasTiptapContent(newComments.message)"
                  @click="createComment(currentTaskId, newComments.message, comment.id)"
                >
                  Отправить
                </button>
              </div>
            </div>
          </div>
          <div v-if="!isOpenNewThread || isExistSubComments" class="base-comment__show-thread" @click="toggleThread">
            <span v-if="!comment.isOpenThread">показать ответы</span>
            <span v-else>свернуть ответ</span>
            <div>
              <IconArrowRight />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.base-comment {
  @include flex(rn);
  gap: 8px;
  padding: 16px;
  border-radius: 8px;
  background-color: var(--light-text-backgroung-primary-5);
  transition: background-color 0.8s ease;

  &_thread {
    background-color: unset;
    padding: 0;
  }


  &_resolved {
    background-color: var(--primary-25);
  }

  &__left {
    padding-bottom: 8px;
    @include flex(cn, a-end, between);
    position: relative;

    &_with-thread {
      &::after {
        content: '';
        position: absolute;
        top: 32px;
        right: 0;
        width: 16px;
        height: calc(100% - 40px);
        border-bottom-left-radius: 8px;
        border-left: 1px solid var(--light-text-backgroung-primary-25);
        border-bottom: 1px solid var(--light-text-backgroung-primary-25);
      }
    }
  }

  &__right {
    @include flex(cn);
    gap: 4px;
    width: 100%;
    min-width: 0;

    &:hover {
      & > .base-comment__header {
        .base-comment__tools {
          opacity: 1;
        }
      }
    }
  }

  &__header {
    @include flex(rn, a-center, between);
  }

  &__message {
    color: var(--white-100);
    @extend %p14-medium;
    margin-top: 4px;
    overflow-x: auto;
    min-width: 0;
  }

  &__user {
    @include flex(rn, a-center);
    gap: 8px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    @media (max-width: $screen-tablet) {
      flex-wrap: wrap;
    }
  }

  &__user-logo {
    width: 32px;
    height: 32px;
    border-radius: 1000px;
    background-color: var(--primary);
    overflow: hidden;
    @include flex(center);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-regular;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__tools {
    @include flex(rn, a-center);
    gap: 8px;
    opacity: 0;
    transition: opacity 0.2s ease;

    & > svg {
      cursor: pointer;
      stroke: var(--light-text-backgroung-primary);

      &:last-child {
        stroke: var(--danger-delete-50);
      }
    }

    @media (max-width: $screen-tablet) {
      opacity: 1;
    }
  }

  &__pen {
    width: 14px;
    height: 14px;
  }

  &__trash {
    margin-left: 8px;
  }

  &__resolve {
    @include flex(rn, a-center);
    gap: 4px;
    cursor: pointer;

    &_active {
      svg {
        stroke: var(--primary);
      }
    }
  }

  &__time {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__form {
    @include flex(cn);
    gap: 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    padding: 16px;
  }

  &__input {
    display: flex;
    @extend %text-s-regular;
    flex: 1;
  }

  &__buttons {
    @include flex(rn);
    gap: 8px;
    margin-left: auto;

    &_edit {
      margin-left: 0;
      margin-top: 12px;
    }
  }

  &__thread {
    margin-top: 10px;
    border-radius: 0 0 8px 8px;
    border-top: none;
    @include flex(cn);
    gap: 8px;
    transition: border-color 0.8s ease;

    &_resolved {
      border-color: var(--primary-dark);
    }

    &_closed {
      margin-top: 0;
    }
  }

  &__thread-list {
    @include flex(cn);
    gap: 18px;
  }

  &__thread-body {
    @include flex(cn);
    gap: 18px;
  }

  &__show-thread {
    @include flex(rn, a-center);
    @extend %p14-medium;
    color: var(--primary-100);
    cursor: pointer;

    div {
      width: 20px;
      height: 20px;
      @include flex(center);
    }

    svg {
      width: 14px;
      height: 14px;
      fill: var(--primary-100);
      transition: transform 0.2s ease;
    }
  }
}
</style>
