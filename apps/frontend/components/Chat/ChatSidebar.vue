<script setup lang="ts">
import { ChatType, type ChatListItem } from '~/stores/chatStore';
import IconPlus from '~/components/Icons/IconPlus.vue';
import IconClose from '~/components/Icons/IconClose.vue';
import IconTrash from '~/components/Icons/IconTrash.vue';
import BaseModal from '~/components/BaseModal.vue';
import { ROLES } from '~/types/user';
import { gitHubEmojis } from '@tiptap/extension-emoji';
import VoiceRoomSection from '~/components/Voice/VoiceRoomSection.vue';

interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  photo_url?: string;
}

interface HttpErrorShape {
  statusCode?: number;
  status?: number;
  response?: {
    status?: number;
  };
}

const chatStore = useChatStore();
const fileStore = useFilesStore();
const userStore = useUserStore();
const projectStore = useProjectStore();
const { $webSocket } = useNuxtApp();

interface VoiceRoomState {
  projectId: number;
  participants: { userId: number; displayName: string; photoUrl: string | null }[];
}

const voiceRoomsMap = ref<Map<number, VoiceRoomState>>(new Map());
const { activeProjectId: voiceActiveProjectId, participants: voiceParticipants } = useVoiceRoom();

const voiceRooms = computed(() =>
  projectStore.projects.map((p) => ({
    projectId: p.id,
    projectName: p.name,
    participants: voiceRoomsMap.value.get(p.id)?.participants ?? [],
  })),
);

const handleWsEvent = (payload: { type: string; data: VoiceRoomState }) => {
  if (payload.type !== 'voice_room_updated') return;
  const { projectId, participants } = payload.data;
  if (participants.length === 0) {
    voiceRoomsMap.value.delete(projectId);
  } else {
    voiceRoomsMap.value.set(projectId, { projectId, participants });
  }
};

onMounted(() => {
  if (voiceActiveProjectId.value !== null) {
    voiceRoomsMap.value.set(voiceActiveProjectId.value, {
      projectId: voiceActiveProjectId.value,
      participants: [...voiceParticipants.value],
    });
  }
  $webSocket.on('event', handleWsEvent);
});

onUnmounted(() => {
  $webSocket.off('event', handleWsEvent);
});
const { onlineUserIds } = storeToRefs(userStore);
const { chatList } = storeToRefs(chatStore);
const { fetchChatMessages, readChatMessages, fetchChatList } = chatStore;
const { $toast } = useNuxtApp();
const route = useRoute();
const router = useRouter();
const { formatMessageDate } = useDateFormatter();

const emojiByName = new Map(gitHubEmojis.map(({ name, emoji }) => [name.toLowerCase(), emoji]));

const getErrorStatusCode = (error: HttpErrorShape): number | null => {
  return error.statusCode ?? error.status ?? error.response?.status ?? null;
};

const renderLastMessage = (message?: string | null): string => {
  if (!message) return 'Начните общение';
  return message.replace(/:([a-z0-9_+-]+):/gi, (_, rawName: string) => {
    const name = rawName.toLowerCase();
    return emojiByName.get(name) ?? `:${rawName}:`;
  });
};

const isSelectUserOpen = ref(false);
const isCreateGroupOpen = ref(false);
const deleteChatModal = ref<InstanceType<typeof BaseModal> | null>(null);
const chatPendingDelete = ref<ChatListItem | null>(null);
const isDeletingChat = ref(false);
const groupName = ref('');
const selectedMemberIds = ref<number[]>([]);
const { users } = storeToRefs(userStore);

const isAdmin = computed(() => userStore.user?.role === ROLES.admin);

const availableUsers = computed(() => {
  const directChatMemberIds = new Set(
    chatList.value.filter((c) => c.type === ChatType.Direct && c.memberId).map((c) => c.memberId as number),
  );
  return users.value.filter((user) => !directChatMemberIds.has(user.id) && user.id !== userStore.user?.id);
});

const allOtherUsers = computed(() => users.value.filter((u) => u.id !== userStore.user?.id));
const activeChatId = computed(() => {
  const value = route.query.chatId;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string') ?? null;
  return typeof value === 'string' ? value : null;
});

const openSelectUser = () => {
  isSelectUserOpen.value = true;
  isCreateGroupOpen.value = false;
};

const openCreateGroup = () => {
  isCreateGroupOpen.value = true;
  isSelectUserOpen.value = false;
  groupName.value = '';
  selectedMemberIds.value = [];
};

const clearActiveChatQuery = async (chatId: string) => {
  if (activeChatId.value !== chatId) return;

  const query = { ...route.query };
  delete query.chatId;
  await router.replace({ query });
};

const requestDeleteChat = (chat: ChatListItem) => {
  if (!chat.chatId) return;
  chatPendingDelete.value = chat;
  deleteChatModal.value?.open();
};

const chatMenu = ref<{ chat: ChatListItem; x: number; y: number } | null>(null);
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressFired = false;

const clearLongPress = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

const onChatTouchStart = (event: TouchEvent, chat: ChatListItem) => {
  if (!chat.chatId) return;
  longPressFired = false;
  const touch = event.touches[0];
  clearLongPress();
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    navigator.vibrate?.(10);
    window.getSelection?.()?.removeAllRanges();
    const x = Math.min(touch.clientX, window.innerWidth - 180);
    const y = Math.min(touch.clientY, window.innerHeight - 80);
    chatMenu.value = { chat, x, y };
  }, 450);
};

const closeChatMenu = () => {
  chatMenu.value = null;
};

const deleteFromMenu = () => {
  const chat = chatMenu.value?.chat;
  closeChatMenu();
  if (chat) requestDeleteChat(chat);
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
    await clearActiveChatQuery(chatId);
    deleteChatModal.value?.close();
    chatPendingDelete.value = null;
    $toast.trash('Чат удалён');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isDeletingChat.value = false;
  }
};

const toggleGroupMember = (userId: number) => {
  const idx = selectedMemberIds.value.indexOf(userId);
  if (idx === -1) {
    selectedMemberIds.value.push(userId);
  } else {
    selectedMemberIds.value.splice(idx, 1);
  }
};

const submitCreateGroup = async () => {
  if (!groupName.value.trim() || selectedMemberIds.value.length === 0) return;
  try {
    const newChat = await chatStore.createGroupChat(groupName.value.trim(), selectedMemberIds.value);
    await fetchChatList();
    isCreateGroupOpen.value = false;
    const prefix = `tracker-chat/${newChat.id}/`;
    await router.replace({ query: { chatId: newChat.id } });
    await fetchChatMessages(String(newChat.id));
    await fileStore.fetchFiles(prefix);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const selectUser = async (user: User) => {
  try {
    const existingChat = chatList.value.find((chat) => chat.type === ChatType.Direct && chat.memberId === user.id);
    if (existingChat) {
      await openChat(existingChat);
    } else {
      const newChat = await chatStore.createChat(user.id);
      const prefix = `tracker-chat/${newChat.id}/`;
      await router.replace({ query: { chatId: newChat.id } });
      await fetchChatMessages(String(newChat.id));
      await readChatMessages(String(newChat.id));
      await fileStore.fetchFiles(prefix);
      await fetchChatList();
    }
    isSelectUserOpen.value = false;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const getInitials = (name: string): string => {
  if (!name) return '';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0][0].toUpperCase();
  }
  return '';
};

const openChat = async (chat: ChatListItem) => {
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  try {
    if (!chat.chatId && chat.type === ChatType.Direct && chat.memberId != null) {
      const newChat = await chatStore.createChat(chat.memberId);
      await router.replace({ query: { chatId: newChat.id } });
      void readChatMessages(String(newChat.id));
    } else if (chat.chatId) {
      await router.replace({ query: { chatId: chat.chatId } });
      if (chat.unreadMessagesCount > 0) {
        void readChatMessages(String(chat.chatId));
      }
    }
  } catch (e) {
    const statusCode = getErrorStatusCode(e as HttpErrorShape);
    if (statusCode === 404) {
      if (!import.meta.server) {
        $toast.error(getErrorMessage(e));
      }
      return;
    }
    if (!import.meta.server) {
      showError(
        createError({
          statusCode: statusCode ?? 500,
          statusMessage: 'Не удалось загрузить сообщения чата',
        }),
      );
    } else {
      throw createError({
        statusCode: statusCode ?? 500,
        statusMessage: 'Не удалось загрузить сообщения чата',
      });
    }
  }
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
</script>

<template>
  <div class="chat-sidebar">
    <VoiceRoomSection :rooms="voiceRooms" />
    <div class="chat-list__header">
      <span>Чаты</span>
      <div class="chat-list__actions">
        <button class="chat-list__new-btn" title="Создать новый чат" @click="openSelectUser">
          <IconPlus />
        </button>
        <button
          v-if="isAdmin"
          class="chat-list__new-btn chat-list__new-btn_group"
          title="Создать групповой чат"
          @click="openCreateGroup"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>
      </div>
    </div>
    <div class="chat-list">
      <ul class="chat-list__items">
        <li
          v-for="chat in chatList"
          :key="String(chat.chatId)"
          :class="['chat-item', { 'chat-item_active': activeChatId === chat.chatId?.toString() }]"
          @click="openChat(chat)"
          @touchstart.passive="onChatTouchStart($event, chat)"
          @touchend="clearLongPress"
          @touchmove.passive="clearLongPress"
          @touchcancel="clearLongPress"
        >
          <div class="chat-item__avatar">
            <div class="chat-item__avatar-fallback">{{ getInitials(chat.chatName) }}</div>
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
              class="chat-item__online-dot"
            />
          </div>
          <div class="chat-item__content">
            <div class="chat-item__header">
              <div class="chat-item__name">{{ chat.chatName }}</div>
              <span class="chat-item__time">{{ chat.lastMessageDate && formatMessageDate(chat.lastMessageDate) }}</span>
            </div>
            <div class="chat-item__message-row">
              <p class="chat-item__message">{{ renderLastMessage(chat.lastMessage) }}</p>
              <span v-if="chat.unreadMessagesCount" class="chat-item__unread">{{ chat.unreadMessagesCount }}</span>
            </div>
          </div>
          <button
            v-if="chat.chatId"
            class="chat-item__delete"
            title="Удалить чат"
            @click.stop="requestDeleteChat(chat)"
          >
            <IconTrash />
          </button>
        </li>
      </ul>
    </div>

    <template v-if="chatMenu">
      <div class="chat-ctx__backdrop" @click="closeChatMenu" @touchstart.passive="closeChatMenu"></div>
      <Transition name="modal" appear>
        <div class="chat-ctx" :style="{ left: chatMenu.x + 'px', top: chatMenu.y + 'px' }">
          <button class="chat-ctx__item chat-ctx__item_danger" @click="deleteFromMenu">
            <IconTrash />
            <span>Удалить</span>
          </button>
        </div>
      </Transition>
    </template>

    <Transition name="modal">
    <div v-if="isSelectUserOpen" class="user-select-modal">
      <div class="user-select-modal__overlay" @click="isSelectUserOpen = false"></div>
      <div class="user-select-modal__content">
        <div class="user-select-modal__header">
          <h3>Создать чат с пользователем</h3>
          <button class="user-select-modal__close" @click="isSelectUserOpen = false">
            <IconClose />
          </button>
        </div>
        <div class="user-select-modal__list">
          <div v-if="availableUsers.length === 0" class="user-select-modal__empty">
            <p>Вы уже создали чаты со всеми доступными пользователями</p>
          </div>
          <div v-for="user in availableUsers" :key="user.id" class="user-select-modal__item" @click="selectUser(user)">
            <div class="user-select-modal__avatar">
              <div class="user-select-modal__avatar-fallback">
                {{ `${user.first_name[0]}${user.last_name[0]}`.toUpperCase() }}
              </div>
              <img
                v-if="user.photo_url"
                v-img-reveal
                :src="user.photo_url"
                :alt="user.first_name"
                loading="lazy"
                decoding="async"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
            </div>
            <div class="user-select-modal__info">
              <div class="user-select-modal__name">{{ user.first_name }} {{ user.last_name }}</div>
              <div class="user-select-modal__email">{{ user.email }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <Transition name="modal">
    <div v-if="isCreateGroupOpen" class="user-select-modal">
      <div class="user-select-modal__overlay" @click="isCreateGroupOpen = false"></div>
      <div class="user-select-modal__content">
        <div class="user-select-modal__header">
          <h3>Создать групповой чат</h3>
          <button class="user-select-modal__close" @click="isCreateGroupOpen = false">
            <IconClose />
          </button>
        </div>
        <div class="group-create__body">
          <input v-model="groupName" class="group-create__input" placeholder="Название группы" type="text" />
          <div class="user-select-modal__list">
            <div v-for="user in allOtherUsers" :key="user.id" class="user-select-modal__item" @click="toggleGroupMember(user.id)">
              <input type="checkbox" :checked="selectedMemberIds.includes(user.id)" class="group-create__checkbox" readonly />
              <div class="user-select-modal__avatar">
                <div class="user-select-modal__avatar-fallback">
                  {{ `${user.first_name[0]}${user.last_name[0]}`.toUpperCase() }}
                </div>
                <img
                  v-if="user.photo_url"
                  v-img-reveal
                  :src="user.photo_url"
                  :alt="user.first_name"
                  loading="lazy"
                  decoding="async"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
              </div>
              <div class="user-select-modal__info">
                <div class="user-select-modal__name">{{ user.first_name }} {{ user.last_name }}</div>
              </div>
            </div>
          </div>
          <div class="group-create__footer">
            <button class="group-create__btn group-create__btn_cancel" @click="isCreateGroupOpen = false">Отмена</button>
            <button
              class="group-create__btn group-create__btn_submit"
              :disabled="!groupName.trim() || selectedMemberIds.length === 0"
              @click="submitCreateGroup"
            >
              Создать
            </button>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <BaseModal ref="deleteChatModal" @close="cancelDeleteChat">
      <div class="delete-chat-modal">
        <div class="delete-chat-modal__header">
          <h2>Удалить чат?</h2>
          <p>
            Все сообщения в чате “{{ chatPendingDelete?.chatName }}” будут безвозвратно удалены
            {{ chatPendingDelete?.type === ChatType.Direct ? 'у вас и у собеседника' : 'у всех участников' }}.
          </p>
        </div>
        <div class="delete-chat-modal__buttons">
          <button
            class="delete-chat-modal__button delete-chat-modal__button_cancel"
            :disabled="isDeletingChat"
            @click="deleteChatModal?.close()"
          >
            Отмена
          </button>
          <button
            class="delete-chat-modal__button delete-chat-modal__button_delete"
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
.chat-sidebar {
  display: flex;
  padding: 20px 10px;
  height: 100%;
  flex-direction: column;
  gap: 16px;

  @media (max-width: $screen-mobile-l) {
    padding: 16px 16px 20px;
    gap: 0;
  }

  &__search {
    input {
      width: 100%;
      background-color: var(--light-text-backgroung-primary-5);
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--white-100);

      &::placeholder {
        color: var(--text-secondary);
      }
    }
  }
}

.chat-list {
  flex: 1;
  min-height: 0;
  overflow: auto;

  @media (max-width: $screen-mobile-l) {
    padding-top: 20px;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text-secondary);
    @extend %h1;

    @media (max-width: $screen-mobile-l) {
      @include display-xs-medium;
      margin-top: 16px;
    }
  }

  &__actions {
    display: flex;
    gap: 4px;
  }

  &__new-btn {
    border: none;
    cursor: pointer;
    color: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    transition: background-color 0.2s ease;

    @media (max-width: $screen-mobile-l) {
      width: 46px;
      height: 46px;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        background-color: var(--light-text-backgroung-primary-5);
      }
    }

    &_group {
      color: var(--text-secondary);

      svg {
        width: 18px;
        height: 18px;
      }
    }
  }

  &__items {
    list-style: none;
    padding: 0;
    margin: 0;

    @include flex(cn);
    gap: 12px;

    @media (max-width: $screen-mobile-l) {
      padding-bottom: var(--mobile-nav-h);
    }

    @media (hover: none) and (pointer: coarse) {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
  }
}

.chat-item {
  position: relative;
  @include flex(rn);
  gap: 8px;
  padding: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;

  &:hover,
  &_active {
    background-color: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
  }

  &__avatar {
    position: relative;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: visible;

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
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--green);
    border: 2px solid var(--dark-text-background-primary);
  }

  &__avatar-fallback {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    @include flex(center);
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }

  &__content {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    @include flex(cn);
    gap: 8px;
  }

  &__header {
    @include flex(rn, between, a-start);
  }

  &__name {
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__time {
    @extend %text-xs-light;
    color: var(--light-text-backgroung-primary-50);
    flex-shrink: 0;
    transition: opacity 0.15s ease;
  }

  &__message-row {
    @include flex(rn, a-center, between);
    gap: 32px;

    :deep(.tiptap) {
      padding: 0;
      video {
        max-width: 380px;
      }
    }
  }

  &__message {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    @extend %p12-light;
    color: var(--white-50);
  }

  &__unread {
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    @extend %text-xs-light;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  &__delete {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background-color: transparent;
    color: var(--white-50);
    cursor: pointer;
    @include flex(center);
    opacity: 0;
    pointer-events: none;
    appearance: none;

    @media (hover: none) and (pointer: coarse) {
      display: none;
    }
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

  &:hover &__delete,
  &:focus-within &__delete {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover &__time,
  &:focus-within &__time {
    opacity: 0;
  }
}

.chat-ctx {
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
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-regular;
    appearance: none;

    svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    &_danger {
      color: var(--danger-delete);
    }

    &:active {
      background: var(--light-text-backgroung-primary-5);
    }
  }
}

.delete-chat-modal {
  padding: 0 24px 8px;

  &__header {
    @include flex(cn);
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

.user-select-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;

  &__overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  &__content {
    position: relative;
    background-color: var(--dark-text-background-primary);
    border-radius: 8px;
    width: 90%;
    max-width: 400px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);

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
    color: var(--light-text-backgroung-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    transition: background-color 0.2s ease;

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__list {
    overflow-y: auto;
    flex: 1;
  }

  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    min-height: 200px;

    p {
      margin: 0;
      @extend %text-m-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    &:hover {
      background-color: var(--light-text-backgroung-primary-5);
    }
  }

  &__avatar {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;

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

  &__avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--primary);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__info {
    flex: 1;
    overflow: hidden;
  }

  &__name {
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__email {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.group-create {
  &__body {
    display: flex;
    flex-direction: column;
    max-height: 70vh;
  }

  &__input {
    margin: 16px 20px 8px;
    background-color: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--white-100);
    @extend %text-m-regular;

    &::placeholder {
      color: var(--text-secondary);
    }
  }

  &__checkbox {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--primary);
  }

  &__footer {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__btn {
    flex: 1;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    @extend %text-m-medium;

    &_cancel {
      background-color: var(--light-text-backgroung-primary-10);
      color: var(--white-100);
    }

    &_submit {
      background-color: var(--primary);
      color: var(--white-100);

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;

  .user-select-modal__content {
    transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
  }
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .user-select-modal__content {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
}
</style>
