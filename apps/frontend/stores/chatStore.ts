import type { JSONContent } from '@tiptap/core';
import { defineStore } from 'pinia';
import type { Chat, ChatMessage } from '~/types/chat';

export enum ChatType {
  Direct = 'direct',
  Group = 'group',
}

export interface ChatListItem {
  chatId?: string | null;
  type: ChatType;
  memberId?: number;
  chatName: string;
  avatarUrl?: string;
  lastMessage?: string | null;
  lastMessageDate?: Date | null;
  unreadMessagesCount: number;
}

interface ChatMessageResonse {
  messages: Chat[];
  meta: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface CreateMessageDto {
  message: string;
}

export const useChatStore = defineStore('chat', () => {
  const config = useRuntimeConfig();
  const chatList = ref<ChatListItem[]>([]);
  const pendingMessageList = ref(true);
  const chatMeta = ref({
    total: 0,
    offset: 0,
    limit: 30,
    hasMore: false,
  });
  const messages = ref<Chat[]>([]);
  const activeChatId = ref<string | null>(null);
  const messagesCache = ref<Map<string, Chat[]>>(new Map());
  const metaCache = ref<Map<string, { total: number; offset: number; limit: number; hasMore: boolean }>>(new Map());
  const fetchChatList = async () => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<ChatListItem[]>(`/api/chats`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
    });
    chatList.value = response;
    if (import.meta.client) void prefetchChats();
    return response;
  };

  const fetchChatMessages = async (chatId: string) => {
    activeChatId.value = chatId;
    if (messagesCache.value.has(chatId)) {
      messages.value = messagesCache.value.get(chatId) || [];
      chatMeta.value = metaCache.value.get(chatId) || { total: 0, offset: 0, limit: 30, hasMore: false };
      return messages.value;
    }

    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<ChatMessageResonse>(`/api/chats/${chatId}/messages`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
    });
    messages.value = response.messages;
    chatMeta.value = response.meta;
    messagesCache.value.set(chatId, response.messages);
    metaCache.value.set(chatId, response.meta);
    return response;
  };

  /**
   * Фоновая подгрузка первой страницы сообщений в кэш — НЕ трогает активные
   * messages/chatMeta, поэтому не мешает открытому чату. Нужна для «телеграм-эффекта»:
   * после неё первое открытие чата мгновенное.
   */
  const prefetchChatMessages = async (chatId: string) => {
    if (!chatId || messagesCache.value.has(chatId)) return;
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<ChatMessageResonse>(`/api/chats/${chatId}/messages`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
    });
    messagesCache.value.set(chatId, response.messages);
    metaCache.value.set(chatId, response.meta);
  };

  /**
   * Префетчит первые страницы для самых свежих чатов с ограничением параллелизма.
   * Вызывается в фоне после загрузки списка чатов. Вебсокет затем держит кэш свежим.
   */
  const prefetchChats = async (limit = 20, concurrency = 4) => {
    if (import.meta.client && typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const targets = chatList.value
      .map((c) => (c.chatId ? String(c.chatId) : null))
      .filter((id): id is string => !!id && !messagesCache.value.has(id))
      .slice(0, limit);

    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const id = targets[cursor++];
        try {
          await prefetchChatMessages(id);
        } catch {
          continue;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
  };

  const fetchOlderMessages = async (chatId: string) => {
    const headers = useRequestHeaders(['cookie']);
    const currentMessages = messagesCache.value.get(chatId) || [];
    const offset = currentMessages.length;

    const response = await $fetch<ChatMessageResonse>(`/api/chats/${chatId}/messages`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      query: { offset: offset.toString(), limit: '30' },
    });
    chatMeta.value = response.meta;
    metaCache.value.set(chatId, response.meta);

    if (response.messages.length > 0) {
      const updated = [...currentMessages, ...response.messages];
      messagesCache.value.set(chatId, updated);
      messages.value = updated;
    }

    return response;
  };
  const readChatMessages = async (chatId: string) => {
    if (!chatId || typeof chatId !== 'string' || chatId === 'null' || chatId === 'undefined' || chatId.includes('[object'))
      return;
    const headers = useRequestHeaders(['cookie']);
    try {
      await $fetch(`/api/chats/${chatId}/read`, {
        method: 'POST',
        credentials: 'include',
        baseURL: config.public.API_URL,
        headers,
      });
      const chat = chatList.value.find((c) => c.chatId === chatId);
      if (chat) {
        chat.unreadMessagesCount = 0;
      }
    } catch (error) {
      console.error('Failed to mark messages as read', error);
    }
  };

  const createChat = async (memberId: number) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<Chat>(`/api/chats`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { memberId },
    });
    return response;
  };

  const fetchChatMembers = async (chatId: string) => {
    const headers = useRequestHeaders(['cookie']);
    return $fetch<{ id: number; first_name: string; last_name: string; photo_url: string }[]>(`/api/chats/${chatId}/members`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
    });
  };

  const createGroupChat = async (name: string, memberIds: number[]) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<Chat>(`/api/chats/group`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { name, memberIds },
    });
    return response;
  };

  const addChatMember = async (chatId: string, userId: number) => {
    const headers = useRequestHeaders(['cookie']);
    await $fetch(`/api/chats/${chatId}/members`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { userId },
    });
  };

  const removeChatMember = async (chatId: string, userId: number) => {
    const headers = useRequestHeaders(['cookie']);
    await $fetch(`/api/chats/${chatId}/members/${userId}`, {
      baseURL: config.public.API_URL,
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
  };

  const removeChatLocally = (chatId: string) => {
    chatList.value = chatList.value.filter((chat) => chat.chatId !== chatId);
    messagesCache.value.delete(chatId);
    metaCache.value.delete(chatId);

    if (messages.value.some((message) => message.chat_id === chatId)) {
      messages.value = [];
      chatMeta.value = { total: 0, offset: 0, limit: 30, hasMore: false };
    }
  };

  const deleteChat = async (chatId: string) => {
    const headers = useRequestHeaders(['cookie']);
    await $fetch(`/api/chats/${chatId}`, {
      baseURL: config.public.API_URL,
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    removeChatLocally(chatId);
  };

  const createMessage = async (
    chatId: string,
    senderId: number,
    message: JSONContent,
    replyToId?: string | null,
  ) => {
    const headers = useRequestHeaders(['cookie']);
    const response = await $fetch<ChatMessage>(`/api/chats/${chatId}/messages`, {
      baseURL: config.public.API_URL,
      method: 'POST',
      credentials: 'include',
      headers,
      body: { message: message, senderId, reply_to_id: replyToId ?? null },
    });
    return response;
  };

  const mergeMessage = (list: Chat[], newMessage: Chat): Chat[] => {
    const idx = list.findIndex((m) => m.id === newMessage.id);
    return idx !== -1 ? list.map((m, i) => (i === idx ? newMessage : m)) : [newMessage, ...list];
  };

  const addMessageToCache = (chatId: string, newMessage: Chat) => {
    if (messagesCache.value.has(chatId)) {
      const cached = messagesCache.value.get(chatId) || [];
      const isNew = !cached.some((m) => m.id === newMessage.id);
      messagesCache.value.set(chatId, mergeMessage(cached, newMessage));
      if (isNew) {
        const meta = metaCache.value.get(chatId);
        if (meta) {
          meta.total += 1;
          metaCache.value.set(chatId, meta);
        }
      }
    }

    if (chatId === activeChatId.value) {
      messages.value = mergeMessage(messages.value, newMessage);
    }
  };

  return {
    chatList,
    fetchChatList,
    messages,
    messagesCache,
    fetchChatMessages,
    prefetchChatMessages,
    prefetchChats,
    fetchOlderMessages,
    createChat,
    createGroupChat,
    fetchChatMembers,
    addChatMember,
    removeChatMember,
    deleteChat,
    removeChatLocally,
    createMessage,
    readChatMessages,
    addMessageToCache,
    chatMeta,
    pendingMessageList,
  };
});
