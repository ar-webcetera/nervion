<script setup lang="ts">
import MessageContent from '~/components/Chat/MessageContent.vue';
import ChatEditor from '~/components/Chat/ChatEditor.vue';
import VoiceRecorder from '~/components/Chat/VoiceRecorder.vue';
import { useDateFormatter } from '~/composables/useDateFormatter';
import { useRoute } from 'vue-router';
import type { JSONContent } from '@tiptap/core';
import { ref } from 'vue';
import { ChatType } from '~/stores/chatStore';
import type { Chat } from '~/types/chat';
import { ROLES } from '~/types/user';
import IconLongBack from '../Icons/IconLongBack.vue';
import { extractPlainText, type TiptapDoc } from '~/utils/extractPainText';
const chatStore = useChatStore();
const route = useRoute();
const router = useRouter();
const { formatMessageDate } = useDateFormatter();
const userStore = useUserStore();
const { messages, chatList, chatMeta, pendingMessageList } = storeToRefs(chatStore);
const chatId = computed(() => {
  const val = route.query?.chatId;
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
});
const messagesContainer = ref<HTMLElement | null>(null);
const editorComponentRef = ref<{ focusEditor: () => void; clearContent: () => void } | null>(null);
let lastMessageObserver: IntersectionObserver | null = null;
const isLoadingOlderMessages = ref(false);
const EMPTY_MESSAGE_CONTENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
};

const currentChatInfo = computed(() => chatList.value.find((c) => c.chatId?.toString() === chatId.value?.toString()));
const isGroupChat = computed(() => currentChatInfo.value?.type === ChatType.Group);

const isMembersOpen = ref(false);
type ChatMember = { id: number; first_name: string; last_name: string; photo_url: string };
const groupMembers = ref<ChatMember[]>([]);
const { users } = storeToRefs(userStore);
const addMemberUserId = ref<number | null>(null);

const openMembersPanel = async () => {
  if (!chatId.value) return;
  groupMembers.value = await chatStore.fetchChatMembers(String(chatId.value));
  isMembersOpen.value = true;
};

const removeMember = async (userId: number) => {
  if (!chatId.value) return;
  await chatStore.removeChatMember(String(chatId.value), userId);
  groupMembers.value = groupMembers.value.filter((m) => m.id !== userId);
};

const addMember = async () => {
  if (!chatId.value || addMemberUserId.value == null) return;
  await chatStore.addChatMember(String(chatId.value), addMemberUserId.value);
  groupMembers.value = await chatStore.fetchChatMembers(String(chatId.value));
  addMemberUserId.value = null;
};

const nonMembers = computed(() => {
  const memberIds = new Set(groupMembers.value.map((m) => m.id));
  return users.value.filter((u) => !memberIds.has(u.id));
});

const loadOlderMessages = async () => {
  if (!chatId.value || !messagesContainer.value || !chatMeta.value.hasMore || isLoadingOlderMessages.value) return;

  const container = messagesContainer.value;
  const containerRect = container.getBoundingClientRect();
  const messageElements = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
  const anchorEl = messageElements.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom > containerRect.top;
  });
  const anchorId = anchorEl?.dataset.messageId;
  const prevAnchorTop = anchorEl ? anchorEl.getBoundingClientRect().top - containerRect.top : null;

  isLoadingOlderMessages.value = true;
  try {
    await chatStore.fetchOlderMessages(String(chatId.value));
    await nextTick();

    if (anchorId && prevAnchorTop !== null) {
      const nextAnchorEl = container.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
      if (nextAnchorEl) {
        const nextAnchorTop = nextAnchorEl.getBoundingClientRect().top - containerRect.top;
        container.scrollTop += nextAnchorTop - prevAnchorTop;
      }
    }
  } finally {
    isLoadingOlderMessages.value = false;
  }
};

const setLastMessageRef = (el: Element | ComponentPublicInstance | null) => {
  if (!el) return;
  const element = el as HTMLElement;

  if (lastMessageObserver) lastMessageObserver.disconnect();

  lastMessageObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && chatMeta.value.hasMore) {
        void loadOlderMessages();
      }
    },
    { root: messagesContainer.value, threshold: 0.5 },
  );

  lastMessageObserver.observe(element);
};

defineProps<{ chatPending: boolean; chatNotFound?: boolean }>();

const scrollToLatest = async () => {
  await nextTick();
  if (!messagesContainer.value) return;
  messagesContainer.value.scrollTop = 0;
};

const newMessage = ref({
  ...EMPTY_MESSAGE_CONTENT,
});

const isVoiceRecording = ref(false);

const sendMessage = async (chatId: string, senderId: number | undefined, message: JSONContent) => {
  try {
    if (!chatId || !senderId) {
      throw new Error('Chat ID or user ID is not defined');
    }
    const content = message;
    const replyToId = replyingTo.value?.id ?? null;
    editorComponentRef.value?.clearContent();
    editorComponentRef.value?.focusEditor();
    replyingTo.value = null;
    const created = await chatStore.createMessage(chatId, senderId, content, replyToId);
    if (created) chatStore.addMessageToCache(chatId, created);
  } catch (error) {
    console.error(error);
  }
};

const sendVoiceMessage = async (src: string, duration: number) => {
  isVoiceRecording.value = false;
  if (!chatId.value || !userStore.user?.id) return;
  const content: JSONContent = {
    type: 'doc',
    content: [{ type: 'audioMessage', attrs: { src, duration } }],
  };
  const created = await chatStore.createMessage(String(chatId.value), userStore.user.id, content);
  if (created) chatStore.addMessageToCache(String(chatId.value), created);
};

const getBubbleName = () => {
  const user = chatList.value.find((chat) => chat.chatId === chatId.value);
  if (!user) return null;
  return `${user.chatName}`;
};

watch(
  () => messages.value,
  (nextMessages, prevMessages) => {
    const nextNewestId = nextMessages[0]?.id ?? null;
    const prevNewestId = prevMessages?.[0]?.id ?? null;
    const hasNewIncomingAtBottom = nextNewestId !== prevNewestId;

    if (!isLoadingOlderMessages.value && hasNewIncomingAtBottom) {
      void scrollToLatest();
    }
    const hasNewMessage = nextNewestId !== prevNewestId;
    if (hasNewMessage && chatId.value && document.visibilityState === 'visible' && document.hasFocus()) {
      void chatStore.readChatMessages(String(chatId.value));
    }
  },
);

const vImgReveal = {
  mounted(el: HTMLImageElement) {
    const reveal = () => {
      el.style.opacity = '1';
    };
    if (el.complete && el.naturalWidth > 0) reveal();
    else el.addEventListener('load', reveal, { once: true });
  },
};

const closeChat = async () => {
  await router.replace({ query: { chatId: null } });
};

const getMessageAuthorKey = (message?: Chat | null) => {
  if (!message) return null;
  return message.author?.id != null ? `user:${message.author.id}` : message.sender_id ? `sender:${message.sender_id}` : null;
};

const isOwnMessage = (message: Chat) => message.author?.id === userStore.user?.id;

const isPreviousSameAuthor = (message: Chat, previousMessage?: Chat) => {
  const authorKey = getMessageAuthorKey(message);

  return authorKey !== null && authorKey === getMessageAuthorKey(previousMessage);
};

const getAuthorInitials = (message: Chat) => useShortName(message.author) ?? 'УП';

const getAuthorPhotoUrl = (message: Chat) => message.author?.photo_url ?? null;

// --- Ответы на сообщения ---
const { $toast } = useNuxtApp();
const replyingTo = ref<Chat | null>(null);
const highlightedMessageId = ref<string | null>(null);

const replyAuthorName = (author: { first_name: string; last_name: string } | null): string =>
  author ? `${author.first_name} ${author.last_name}`.trim() : 'Удалённый пользователь';

const replySnippet = (msg: Chat): string => {
  if (msg.is_deleted) return 'Сообщение удалено';
  return extractPlainText(msg.message as TiptapDoc, 80) || 'Вложение';
};

const startReply = (message: Chat) => {
  replyingTo.value = message;
  window.getSelection?.()?.removeAllRanges();
  editorComponentRef.value?.focusEditor();
};

const cancelReply = () => {
  replyingTo.value = null;
};

const messageMenu = ref<{ message: Chat; x: number; y: number } | null>(null);
let msgLongPressTimer: ReturnType<typeof setTimeout> | null = null;
let msgLongPressFired = false;

const clearMessageLongPress = () => {
  if (msgLongPressTimer) {
    clearTimeout(msgLongPressTimer);
    msgLongPressTimer = null;
  }
};

const onMessageTouchStart = (event: TouchEvent, message: Chat) => {
  msgLongPressFired = false;
  const touch = event.touches[0];
  clearMessageLongPress();
  msgLongPressTimer = setTimeout(() => {
    msgLongPressFired = true;
    navigator.vibrate?.(10);
    window.getSelection?.()?.removeAllRanges();
    const x = Math.min(touch.clientX, window.innerWidth - 180);
    const y = Math.min(touch.clientY, window.innerHeight - 80);
    messageMenu.value = { message, x, y };
  }, 450);
};

const closeMessageMenu = () => {
  messageMenu.value = null;
};

const replyFromMenu = () => {
  const message = messageMenu.value?.message;
  closeMessageMenu();
  if (message) startReply(message);
};

const scrollToMessage = (id: string) => {
  const container = messagesContainer.value;
  if (!container) return;
  const target = container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  if (!target) {
    $toast.warning('Сообщение выше — прокрутите чат, чтобы его увидеть');
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightedMessageId.value = id;
  window.setTimeout(() => {
    if (highlightedMessageId.value === id) highlightedMessageId.value = null;
  }, 1600);
};
</script>

<template>
  <div class="chat-view">
    <div v-if="getBubbleName()" class="chat-view__bubble-name">
      <span @click="closeChat"> <IconLongBack /> {{ getBubbleName() }}</span>
      <button v-if="isGroupChat" class="chat-view__members-btn" title="Участники" @click="openMembersPanel">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="width: 14px; height: 14px; flex-shrink: 0"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Участники
      </button>
    </div>

    <div v-if="isMembersOpen" class="members-panel">
      <div class="members-panel__overlay" @click="isMembersOpen = false" />
      <div class="members-panel__content">
        <div class="members-panel__header">
          <h3>Участники группы</h3>
          <button class="members-panel__close" @click="isMembersOpen = false">✕</button>
        </div>
        <ul class="members-panel__list">
          <li v-for="member in groupMembers" :key="member.id" class="members-panel__item">
            <div class="members-panel__avatar">
              <span>{{ `${member.first_name[0]}${member.last_name[0]}`.toUpperCase() }}</span>
              <img
                v-if="member.photo_url"
                v-img-reveal
                :src="member.photo_url"
                :alt="member.first_name"
                loading="lazy"
                decoding="async"
              />
            </div>
            <span class="members-panel__name">{{ member.first_name }} {{ member.last_name }}</span>
            <button
              v-if="member.id !== userStore.user?.id && userStore.user?.role === ROLES.admin"
              class="members-panel__remove"
              title="Удалить из группы"
              @click="removeMember(member.id)"
            >
              ✕
            </button>
          </li>
        </ul>
        <div v-if="nonMembers.length && userStore.user?.role === ROLES.admin" class="members-panel__add">
          <select v-model="addMemberUserId" class="members-panel__select">
            <option :value="null" disabled>Добавить участника...</option>
            <option v-for="u in nonMembers" :key="u.id" :value="u.id">{{ u.first_name }} {{ u.last_name }}</option>
          </select>
          <button class="members-panel__add-btn" :disabled="addMemberUserId == null" @click="addMember">Добавить</button>
        </div>
      </div>
    </div>
    <div v-if="chatId && (pendingMessageList || chatPending)" class="loader__wrapper">
      <div class="loader"></div>
    </div>
    <div v-else-if="chatId && chatNotFound" class="chat-view__empty">
      <h3>Чат не найден</h3>
      <p>Такого чата не существует или у вас нет доступа</p>
      <button class="chat-view__back-btn" @click="closeChat">Перейти к списку чатов</button>
    </div>
    <template v-else-if="chatId">
      <div ref="messagesContainer" class="chat-view__messages">
        <template v-if="messages.length">
          <div
            v-for="(message, idx) in messages"
            :ref="idx === messages.length - 1 ? setLastMessageRef : undefined"
            :key="message.id"
            :data-message-id="message.id"
            :class="[
              'message',
              {
                message_own: isOwnMessage(message),
                message_last: idx > 0 && !isPreviousSameAuthor(message, messages[idx - 1]),
                message_highlighted: highlightedMessageId === message.id,
              },
            ]"
          >
            <div
              :class="[
                'message__avatar',
                { message__avatar_hidden: idx > 0 && isPreviousSameAuthor(message, messages[idx - 1]) },
              ]"
            >
              <span>{{ getAuthorInitials(message) }}</span>
              <img
                v-if="getAuthorPhotoUrl(message)"
                v-img-reveal
                :src="getAuthorPhotoUrl(message)!"
                loading="lazy"
                decoding="async"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
            </div>
            <div
              class="message__bubble"
              @dblclick="startReply(message)"
              @touchstart.passive="onMessageTouchStart($event, message)"
              @touchend="clearMessageLongPress"
              @touchmove.passive="clearMessageLongPress"
              @touchcancel="clearMessageLongPress"
            >
              <button
                v-if="message.reply_to"
                type="button"
                class="message__quote"
                @click="scrollToMessage(message.reply_to.id)"
              >
                <span class="message__quote-author">{{ replyAuthorName(message.reply_to.author) }}</span>
                <span class="message__quote-text">
                  {{ message.reply_to.is_deleted ? 'Сообщение удалено' : message.reply_to.snippet || 'Вложение' }}
                </span>
              </button>
              <div class="message__text">
                <MessageContent :key="message.id" :value="message.message" />
              </div>
              <span class="message__time">{{ formatMessageDate(message.createdAt) }}</span>
              <button type="button" class="message__reply-btn" title="Ответить" @click="startReply(message)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </template>
        <div v-else class="chat-view__empty">
          <img src="@/assets/empty_chat.webp" alt="" />
          <h3>Начните разговор</h3>
          <p>Напишите первое сообщение</p>
        </div>
      </div>
      <footer v-if="chatId" class="chat-view__footer">
        <div v-if="replyingTo" class="chat-view__reply-bar">
          <span class="chat-view__reply-bar-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" fill="currentColor" />
            </svg>
          </span>
          <div class="chat-view__reply-bar-body">
            <span class="chat-view__reply-bar-author">{{ replyAuthorName(replyingTo.author) }}</span>
            <span class="chat-view__reply-bar-text">{{ replySnippet(replyingTo) }}</span>
          </div>
          <button type="button" class="chat-view__reply-bar-close" title="Отменить ответ" @click="cancelReply">
            ✕
          </button>
        </div>
        <ClientOnly>
          <VoiceRecorder
            v-if="isVoiceRecording"
            :chat-id="String(chatId)"
            :prefix="`tracker-chat/${chatId}/voice/`"
            @send="sendVoiceMessage"
            @cancel="isVoiceRecording = false"
          />
          <ChatEditor
            v-else
            ref="editorComponentRef"
            v-model="newMessage"
            :is-editable="true"
            :value="newMessage"
            show-mic
            @enter="sendMessage(chatId as string, userStore.user?.id, newMessage)"
            @send="sendMessage(chatId as string, userStore.user?.id, newMessage)"
            @mic="isVoiceRecording = true"
          />
        </ClientOnly>
      </footer>
    </template>

    <div v-else class="chat-view__empty">
      <img src="@/assets/unset_chat.webp" alt="" />
      <h3>Здесь будут ваши диалоги</h3>
      <p>Выберите диалог из списка слева</p>
    </div>

    <template v-if="messageMenu">
      <div class="msg-ctx__backdrop" @click="closeMessageMenu" @touchstart.passive="closeMessageMenu"></div>
      <Transition name="modal" appear>
        <div class="msg-ctx" :style="{ left: messageMenu.x + 'px', top: messageMenu.y + 'px' }">
          <button class="msg-ctx__item" @click="replyFromMenu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" fill="currentColor" />
            </svg>
            <span>Ответить</span>
          </button>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped lang="scss">
.loader {
  &__wrapper {
    @include flex(center);
    height: 100%;
    width: 100%;
  }
}

.chat-view {
  position: relative;
  @include flex(cn);
  gap: 25px;
  overflow: hidden;

  height: 100%;
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0;
  }

  &__bubble-name {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    & > span {
      @media (max-width: $screen-mobile-l) {
        @include flex(rn, a-center);
        gap: 8px;
      }

      svg {
        display: none;

        @media (max-width: $screen-mobile-l) {
          display: block;
        }
      }
    }
  }

  &__members-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 10px;
    @extend %text-s-regular;
    transition: background-color 0.2s ease;
    flex-shrink: 0;

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__header {
    padding: 0 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__messages {
    flex-grow: 1;
    overflow-y: auto;
    max-height: calc(100vh - 78px);
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;

    @media (max-width: $screen-mobile-l) {
      margin-top: 74px;
    }

    @media (hover: none) and (pointer: coarse) {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
  }

  &__footer {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    flex-shrink: 0;
    padding: 10px 12px;
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
  }

  &__reply-bar {
    flex: 0 0 100%;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    order: -1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--primary);
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__reply-bar-icon {
    @include flex(center);
    color: var(--primary);
    flex-shrink: 0;
  }

  &__reply-bar-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  &__reply-bar-author {
    @extend %text-xs-medium;
    color: var(--primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__reply-bar-text {
    @extend %text-xs-regular;
    color: var(--white-50);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__reply-bar-close {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    @include flex(center);
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--white-50);
    cursor: pointer;
    transition: color 0.15s ease;

    &:hover {
      color: var(--white-100);
    }
  }

  &__empty {
    @include flex(cn, center);
    gap: 4px;
    height: 100%;
    width: 100%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);

    img {
      width: 310px;
      height: auto;
    }

    h3 {
      margin: 0;
      @extend %display-m-medium;
      text-align: center;
    }

    p {
      @extend %text-m-regular;
      text-align: center;
    }
  }

  &__back-btn {
    margin-top: 8px;
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: var(--primary);
    color: var(--white-100);
    @extend %text-m-medium;
    cursor: pointer;
    transition: opacity 0.15s ease;

    &:hover {
      opacity: 0.85;
    }
  }
}

.chat-info {
  &__name {
    @extend %text-l-medium;
    color: var(--white-100);
  }
}

.message {
  @include flex(rn, a-end);
  position: relative;
  gap: 8px;
  max-width: 50%;

  @media (max-width: $screen-mobile-l) {
    max-width: 400px;
  }

  p,
  span {
    margin: 0;
    line-height: 1.2;
  }

  :deep(.tiptap) {
    padding: 0;
    min-width: 0;
    font-size: 16px;
    line-height: 1.5;
  }

  :deep(.tableWrapper) {
    max-width: 100%;
    overflow-x: auto;
  }

  &_own {
    .message__bubble {
      background-color: var(--primary-50);
    }
  }

  &_last {
    margin-bottom: 8px;
  }

  &__avatar {
    position: relative;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 50%;
    background-color: var(--primary);
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary);
    @include flex(center);

    &_hidden {
      background-color: unset;

      & > * {
        display: none;
      }
    }

    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.15s;
    }
  }

  &__bubble {
    position: relative;
    border-radius: 8px 8px 8px 0;
    background: var(--white-5);
    @include flex(cn);
    gap: 4px;
    padding: 8px;
    min-width: 0;

    @media (hover: none) and (pointer: coarse) {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
  }

  &__text {
    margin: 0;
    font-size: 16px;
    line-height: 1.5;
    color: var(--white-100);
    min-width: 0;
    width: 100%;
  }

  &__time {
    color: var(--white-50);
    @extend %p12-light;
    align-self: flex-end;
    white-space: nowrap;
  }

  &__quote {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 4px 8px;
    border: none;
    border-left: 3px solid var(--primary);
    border-radius: 4px;
    background: var(--light-text-backgroung-primary-5);
    cursor: pointer;
    overflow: hidden;
    transition: background 0.15s ease;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__quote-author {
    @extend %text-xs-medium;
    align-self: flex-start;
    max-width: 100%;
    text-align: left;
    color: var(--primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__quote-text {
    @extend %text-xs-regular;
    align-self: flex-start;
    max-width: 100%;
    text-align: left;
    color: var(--white-50);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__reply-btn {
    position: absolute;
    top: 50%;
    right: -32px;
    transform: translateY(-50%);
    width: 28px;
    height: 28px;
    padding: 0;
    @include flex(center);
    border: none;
    border-radius: 50%;
    background: var(--light-text-backgroung-primary-5);
    color: var(--white-50);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;

    @media (hover: none) and (pointer: coarse) {
      display: none;
    }
    transition:
      opacity 0.15s ease,
      color 0.15s ease,
      background 0.15s ease;

    &::before {
      content: '';
      position: absolute;
      top: -8px;
      bottom: -8px;
      left: -14px;
      right: 0;
    }

    &:hover {
      color: var(--white-100);
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &:hover &__reply-btn {
    opacity: 1;
    pointer-events: auto;
  }

  &_highlighted {
    .message__bubble {
      animation: message-highlight 1.6s ease;
    }
  }
}

.msg-ctx {
  position: fixed;
  z-index: 1001;
  min-width: 160px;
  padding: 6px;
  border-radius: 12px;
  background: var(--dark-text-background-primary);
  border: 1px solid var(--light-text-backgroung-primary-5);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);

  &__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  &__item {
    @include flex(rn, j-start, a-center);
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--white-100);
    cursor: pointer;
    @extend %text-s-regular;
    appearance: none;

    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    &:active {
      background: var(--light-text-backgroung-primary-5);
    }
  }
}

@keyframes message-highlight {
  0%,
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
  25% {
    box-shadow: 0 0 0 2px var(--primary);
  }
}

.members-panel {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;

  &__overlay {
    position: absolute;
    inset: 0;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  &__content {
    position: relative;
    background-color: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    width: 360px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    h3 {
      margin: 0;
      @extend %text-l-medium;
      color: var(--light-text-backgroung-primary);
    }
  }

  &__close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 16px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__list {
    list-style: none;
    padding: 8px 0;
    margin: 0;
    overflow-y: auto;
    flex: 1;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 20px;
  }

  &__avatar {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    background-color: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);

    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.15s;
    }
  }

  &__name {
    flex: 1;
    @extend %text-m-regular;
    color: var(--light-text-backgroung-primary);
  }

  &__remove {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 12px;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.2s ease,
      background-color 0.2s ease;

    &:hover {
      color: var(--danger-delete);
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__add {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__select {
    flex: 1;
    background-color: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--white-100);
    @extend %text-s-regular;

    option {
      background-color: var(--dark-text-background-primary);
    }
  }

  &__add-btn {
    background-color: var(--primary);
    color: var(--white-100);
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
    @extend %text-s-medium;

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
}
</style>
