<script setup lang="ts">
import MessageContent from '~/components/Chat/MessageContent.vue';
import ChatEditor from '~/components/Chat/ChatEditor.vue';
import VoiceRecorder from '~/components/Chat/VoiceRecorder.vue';
import IconChat from '~/components/Icons/IconChat.vue';
import IconClose from '~/components/Icons/IconClose.vue';
import IconArrowLeft from '~/components/Icons/IconArrowLeft.vue';
import IconTrash from '~/components/Icons/IconTrash.vue';
import BaseModal from '~/components/BaseModal.vue';
import type { JSONContent } from '@tiptap/core';
import { ChatType, type ChatListItem } from '~/stores/chatStore';
import type { Chat } from '~/types/chat';
import { gitHubEmojis } from '@tiptap/extension-emoji';

const chatStore = useChatStore();
const userStore = useUserStore();
const fileStore = useFilesStore();
const route = useRoute();
const { formatMessageDate } = useDateFormatter();
const { $toast } = useNuxtApp();

const emojiByName = new Map(gitHubEmojis.map(({ name, emoji }) => [name.toLowerCase(), emoji]));

const renderLastMessage = (message?: string | null): string => {
  if (!message) return 'Начните общение';
  return message.replace(/:([a-z0-9_+-]+):/gi, (_, rawName: string) => {
    const name = rawName.toLowerCase();
    return emojiByName.get(name) ?? `:${rawName}:`;
  });
};

const { chatList, messagesCache } = storeToRefs(chatStore);
const { onlineUserIds } = storeToRefs(userStore);
const isOpen = ref(false);
const selectedChatId = ref<string | null>(null);
const deleteChatModal = ref<InstanceType<typeof BaseModal> | null>(null);
const chatPendingDelete = ref<ChatListItem | null>(null);
const isDeletingChat = ref(false);
const pendingMessages = ref(false);
const editorRef = ref<{ focusEditor: () => void; clearContent: () => void } | null>(null);
const messagesContainerRef = ref<HTMLElement | null>(null);
const EMPTY_MESSAGE_CONTENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
};

const isChatPage = computed(() => route.name === 'chat');

const totalUnread = computed(() => chatList.value.reduce((sum, chat) => sum + (chat.unreadMessagesCount || 0), 0));

const currentChat = computed(() => chatList.value.find((c) => c.chatId?.toString() === selectedChatId.value));

const widgetMessages = computed(() => (selectedChatId.value ? messagesCache.value.get(selectedChatId.value) || [] : []));

const getInitials = (name: string): string => {
  if (!name) return '';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1 && parts[0].length > 0) return parts[0][0].toUpperCase();
  return '';
};

const openChat = async (chat: ChatListItem) => {
  if (!chat.chatId) return;
  selectedChatId.value = String(chat.chatId);
  pendingMessages.value = true;
  try {
    await chatStore.fetchChatMessages(String(chat.chatId));
    if (chat.unreadMessagesCount > 0) {
      await chatStore.readChatMessages(String(chat.chatId));
    }
    await fileStore.fetchFiles(`tracker-chat/${chat.chatId}/`);
  } finally {
    pendingMessages.value = false;
  }
};

const goBack = () => {
  selectedChatId.value = null;
};

const requestDeleteChat = (chat: ChatListItem) => {
  if (!chat.chatId) return;
  chatPendingDelete.value = chat;
  deleteChatModal.value?.open();
};

const cancelDeleteChat = () => {
  if (isDeletingChat.value) return;
  chatPendingDelete.value = null;
};

const confirmDeleteChat = async () => {
  const chat = chatPendingDelete.value;
  if (!chat?.chatId || isDeletingChat.value) return;

  isDeletingChat.value = true;
  try {
    const chatId = String(chat.chatId);
    await chatStore.deleteChat(chatId);
    if (selectedChatId.value === chatId) {
      selectedChatId.value = null;
    }
    deleteChatModal.value?.close();
    chatPendingDelete.value = null;
    $toast.trash('Чат удалён');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isDeletingChat.value = false;
  }
};

const newMessage = ref<JSONContent>({
  ...EMPTY_MESSAGE_CONTENT,
});

const isVoiceRecording = ref(false);

const sendMessage = async () => {
  if (!selectedChatId.value || !userStore.user?.id) return;
  const message = newMessage.value;
  editorRef.value?.clearContent();
  editorRef.value?.focusEditor();
  const created = await chatStore.createMessage(selectedChatId.value, userStore.user.id, message);
  if (created) chatStore.addMessageToCache(selectedChatId.value, created);
};

const sendVoiceMessage = async (src: string, duration: number) => {
  isVoiceRecording.value = false;
  if (!selectedChatId.value || !userStore.user?.id) return;
  const content: JSONContent = {
    type: 'doc',
    content: [{ type: 'audioMessage', attrs: { src, duration } }],
  };
  const created = await chatStore.createMessage(selectedChatId.value, userStore.user.id, content);
  if (created) chatStore.addMessageToCache(selectedChatId.value, created);
};

const toggleOpen = async () => {
  isOpen.value = !isOpen.value;
  if (isOpen.value && selectedChatId.value) {
    const chat = currentChat.value;
    if (chat?.unreadMessagesCount && chat.unreadMessagesCount > 0) {
      await chatStore.readChatMessages(selectedChatId.value);
    }
  }
};

const isPageActive = () => document.visibilityState === 'visible' && document.hasFocus();

const tryReadMessages = () => {
  if (isOpen.value && selectedChatId.value && isPageActive()) {
    const unread = currentChat.value?.unreadMessagesCount ?? 0;
    if (unread > 0) {
      void chatStore.readChatMessages(selectedChatId.value);
    }
  }
};

watch(widgetMessages, async () => {
  await nextTick();
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = 0;
  }
  tryReadMessages();
});

watch(chatList, () => {
  if (!selectedChatId.value) return;
  const selectedChatExists = chatList.value.some((chat) => chat.chatId?.toString() === selectedChatId.value);
  if (!selectedChatExists) {
    selectedChatId.value = null;
  }
});

const PANEL_HEIGHT_KEY = 'floating-chat-panel-height';
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 520;

const panelHeight = ref(DEFAULT_HEIGHT);

onMounted(() => {
  document.addEventListener('visibilitychange', tryReadMessages);
  const saved = localStorage.getItem(PANEL_HEIGHT_KEY);
  if (saved) {
    const n = parseInt(saved, 10);
    if (n >= MIN_HEIGHT && n <= MAX_HEIGHT) panelHeight.value = n;
  }
});

onUnmounted(() => {
  document.removeEventListener('visibilitychange', tryReadMessages);
});

let resizeStartY = 0;
let resizeStartHeight = 0;

const startResize = (e: MouseEvent) => {
  resizeStartY = e.clientY;
  resizeStartHeight = panelHeight.value;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', stopResize);
};

const onResizeMove = (e: MouseEvent) => {
  const delta = resizeStartY - e.clientY;
  panelHeight.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartHeight + delta));
};

const stopResize = () => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', stopResize);
  localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight.value));
};

const vImgReveal = {
  mounted(el: HTMLImageElement) {
    const reveal = () => {
      el.style.opacity = '1';
    };
    if (el.complete && el.naturalWidth > 0) reveal();
    else el.addEventListener('load', reveal, { once: true });
  },
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
</script>

<template>
  <div v-if="!isChatPage" class="floating-chat">
    <Transition name="chat-popup">
      <div v-if="isOpen" class="floating-chat__panel" :style="{ height: `${panelHeight}px` }">
        <div class="floating-chat__resize-handle" @mousedown.prevent="startResize" />
        <div class="floating-chat__header">
          <button v-if="selectedChatId" class="floating-chat__icon-btn" @click="goBack">
            <IconArrowLeft />
          </button>
          <span class="floating-chat__title">{{ selectedChatId ? currentChat?.chatName : 'Чаты' }}</span>
          <button class="floating-chat__icon-btn" @click="isOpen = false">
            <IconClose />
          </button>
        </div>

        <div v-if="!selectedChatId" class="floating-chat__list">
          <ul>
            <li v-for="chat in chatList" :key="String(chat.chatId)" class="floating-chat__item" @click="openChat(chat)">
              <div class="floating-chat__avatar">
                <div class="floating-chat__avatar-fallback">{{ getInitials(chat.chatName) }}</div>
                <img
                  v-if="chat.type === ChatType.Direct && chat.avatarUrl"
                  v-img-reveal
                  :src="chat.avatarUrl"
                  :alt="chat.chatName"
                  loading="lazy"
                  decoding="async"
                />
                <span
                  v-if="chat.type === ChatType.Direct && chat.memberId != null && onlineUserIds.has(chat.memberId)"
                  class="floating-chat__online-dot"
                />
              </div>
              <div class="floating-chat__item-content">
                <div class="floating-chat__item-row">
                  <span class="floating-chat__item-name">{{ chat.chatName }}</span>
                  <span class="floating-chat__item-time">{{
                    chat.lastMessageDate ? formatMessageDate(chat.lastMessageDate) : ''
                  }}</span>
                </div>
                <div class="floating-chat__item-row">
                  <p class="floating-chat__item-preview">
                    {{ renderLastMessage(chat.lastMessage) }}
                  </p>
                  <span v-if="chat.unreadMessagesCount" class="floating-chat__unread-badge">
                    {{ chat.unreadMessagesCount }}
                  </span>
                </div>
              </div>
              <button v-if="chat.chatId" class="floating-chat__delete" title="Удалить чат" @click.stop="requestDeleteChat(chat)">
                <IconTrash />
              </button>
            </li>
            <li v-if="!chatList.length" class="floating-chat__empty-list">
              <p>Нет активных чатов</p>
            </li>
          </ul>
        </div>

        <template v-else>
          <div v-if="pendingMessages" class="floating-chat__loader">
            <div class="loader"></div>
          </div>
          <div v-else ref="messagesContainerRef" class="floating-chat__messages">
            <template v-if="widgetMessages.length">
              <div
                v-for="(message, idx) in widgetMessages"
                :key="message.id"
                :class="[
                  'fchat-msg',
                  {
                    'fchat-msg_own': isOwnMessage(message),
                    'fchat-msg_spaced': idx > 0 && !isPreviousSameAuthor(message, widgetMessages[idx - 1]),
                  },
                ]"
              >
                <div
                  :class="[
                    'fchat-msg__avatar',
                    {
                      'fchat-msg__avatar_hidden': idx > 0 && isPreviousSameAuthor(message, widgetMessages[idx - 1]),
                    },
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
                <div class="fchat-msg__bubble">
                  <MessageContent :key="message.id" :value="message.message" />
                  <span class="fchat-msg__time">{{ formatMessageDate(message.createdAt) }}</span>
                </div>
              </div>
            </template>
            <div v-else class="floating-chat__empty-msg">
              <p>Напишите первое сообщение</p>
            </div>
          </div>
          <footer class="floating-chat__footer">
            <ClientOnly>
              <VoiceRecorder
                v-if="isVoiceRecording"
                :chat-id="selectedChatId!"
                :prefix="`tracker-chat/${selectedChatId}/voice/`"
                @send="sendVoiceMessage"
                @cancel="isVoiceRecording = false"
              />
              <ChatEditor
                v-else
                ref="editorRef"
                v-model="newMessage"
                :is-editable="true"
                :value="newMessage"
                :file-prefix="`tracker-chat/${selectedChatId}/`"
                show-mic
                @enter="sendMessage"
                @send="sendMessage"
                @mic="isVoiceRecording = true"
              />
            </ClientOnly>
          </footer>
        </template>
      </div>
    </Transition>

    <button class="floating-chat__btn" :class="{ 'floating-chat__btn_active': isOpen }" @click="toggleOpen">
      <IconChat />
      <span v-if="totalUnread > 0 && !isOpen" class="floating-chat__badge">
        {{ totalUnread > 99 ? '99+' : totalUnread }}
      </span>
    </button>

    <BaseModal ref="deleteChatModal" @close="cancelDeleteChat">
      <div class="floating-chat-delete">
        <div class="floating-chat-delete__header">
          <h2>Удалить чат?</h2>
          <p>
            Все сообщения в чате “{{ chatPendingDelete?.chatName }}” будут безвозвратно удалены
            {{ chatPendingDelete?.type === ChatType.Direct ? 'у вас и у собеседника' : 'у всех участников' }}.
          </p>
        </div>
        <div class="floating-chat-delete__buttons">
          <button
            class="floating-chat-delete__button floating-chat-delete__button_cancel"
            :disabled="isDeletingChat"
            @click="deleteChatModal?.close()"
          >
            Отмена
          </button>
          <button
            class="floating-chat-delete__button floating-chat-delete__button_delete"
            :disabled="isDeletingChat"
            @click="confirmDeleteChat"
          >
            {{ isDeletingChat ? 'Удаление...' : 'Удалить' }}
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
.floating-chat {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;

  @media (max-width: $screen-mobile-l) {
    display: none;
  }

  &__btn {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px var(--black-40);
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;
    flex-shrink: 0;

    svg {
      width: 24px;
      height: 24px;
    }

    &:hover {
      transform: scale(1.08);
    }

    &_active {
      background-color: var(--primary-50);
    }
  }

  &__badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background-color: var(--danger-delete);
    color: var(--light-text-backgroung-primary);
    border-radius: 50%;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    @extend %text-xs-medium;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  &__panel {
    width: 450px;
    background-color: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px var(--black-40);
  }

  &__resize-handle {
    height: 6px;
    cursor: ns-resize;
    flex-shrink: 0;

    &::after {
      content: '';
      display: block;
      width: 32px;
      height: 3px;
      background: var(--light-text-backgroung-primary-10);
      border-radius: 2px;
      margin: 1px auto 0;
      transition: background-color 0.15s ease;
    }

    &:hover::after {
      background: var(--light-text-backgroung-primary-25);
    }
  }

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }

  &__title {
    flex: 1;
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary-50);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    transition: background-color 0.2s ease;
    flex-shrink: 0;

    svg {
      width: 20px;
      height: 20px;
    }

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__list {
    flex: 1;
    overflow-y: auto;

    ul {
      list-style: none;
      padding: 8px 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }

    &:hover .floating-chat__delete,
    &:focus-within .floating-chat__delete {
      opacity: 1;
    }
  }

  &__avatar {
    position: relative;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: visible;
    background-color: var(--primary);

    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.15s;
    }
  }

  &__online-dot {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background-color: var(--green);
    border: 2px solid var(--dark-text-background-primary);
  }

  &__avatar-fallback {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__item-name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__item-time {
    @extend %text-xs-light;
    color: var(--light-text-backgroung-primary-50);
    flex-shrink: 0;
  }

  &__item-preview {
    margin: 0;
    @extend %p12-light;
    color: var(--white-50);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__unread-badge {
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    border-radius: 50%;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__delete {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    border-radius: 5px;
    background-color: transparent;
    color: var(--white-50);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    appearance: none;
    transition:
      background-color 0.2s ease,
      color 0.2s ease,
      opacity 0.2s ease;

    svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
    }

    &:hover,
    &:focus-visible {
      background-color: var(--danger-delete-10);
      color: var(--danger-delete);
      opacity: 1;
    }

    @media (hover: none) {
      opacity: 0.75;
    }
  }

  &__empty-list,
  &__empty-msg {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;

    p {
      margin: 0;
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
      text-align: center;
    }
  }

  &__loader {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column-reverse;
    gap: 6px;
  }

  &__footer {
    flex-shrink: 0;
    padding: 10px 16px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(12px);
  }
}

.floating-chat-delete {
  padding: 0 24px 8px;

  &__header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;

    h2 {
      margin: 0;
      @extend %text-l-medium;
      color: var(--light-text-backgroung-primary);
    }

    p {
      margin: 0;
      @extend %text-m-regular;
      color: var(--light-text-backgroung-primary-50);
      line-height: 1.5;
    }
  }

  &__buttons {
    display: flex;
    gap: 8px;
  }

  &__button {
    flex: 1;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    cursor: pointer;
    @extend %text-m-medium;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    &_cancel {
      background-color: var(--light-text-backgroung-primary-10);
      color: var(--white-100);
    }

    &_delete {
      background-color: var(--danger-delete);
      color: var(--white-100);
    }
  }
}

.loader {
  width: 32px;
  height: 32px;
  border: 3px solid var(--light-text-backgroung-primary-10);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fchat-msg {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  max-width: 280px;

  &_spaced {
    margin-bottom: 6px;
  }

  &_own {
    align-self: flex-end;
    flex-direction: row-reverse;

    .fchat-msg__bubble {
      background-color: var(--primary-50);
      border-radius: 8px 8px 0 8px;
    }
  }

  &__avatar {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    background-color: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary);

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
    border-radius: 8px 8px 8px 0;
    background: var(--white-5);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    :deep(.tiptap) {
      padding: 0;
      font-size: 16px;
    }
  }

  &__time {
    color: var(--white-50);
    font-size: 10px;
    white-space: nowrap;
    align-self: flex-end;
  }
}

.chat-popup-enter-active,
.chat-popup-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.chat-popup-enter-from,
.chat-popup-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}
</style>
