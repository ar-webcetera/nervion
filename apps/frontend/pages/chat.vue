<script setup lang="ts">
import { createError, definePageMeta, showError } from '#imports';
import ChatSidebar from '~/components/Chat/ChatSidebar.vue';
import ChatView from '~/components/Chat/ChatView.vue';
const chatStore = useChatStore();
const fileStore = useFilesStore();
const { fetchChatList, fetchChatMessages } = chatStore;
const { pendingMessageList } = storeToRefs(chatStore);
const route = useRoute();

const chatPending = ref(true);
const getSingleQueryValue = (value: string | null | Array<string | null> | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value.find((item) => typeof item === 'string') ?? null : value;
};
const chatId = computed(() => getSingleQueryValue(route.query?.chatId));

interface HttpErrorShape {
  statusCode?: number;
  status?: number;
  response?: {
    status?: number;
  };
}

const getErrorStatusCode = (error: HttpErrorShape): number | null => {
  return error.statusCode ?? error.status ?? error.response?.status ?? null;
};

const raisePageError = (statusCode: number, statusMessage: string) => {
  const pageError = createError({ statusCode, statusMessage });
  if (import.meta.client) {
    showError(pageError);
    return;
  }
  throw pageError;
};

const loadChatPageData = async () => {
  try {
    if (chatId.value) {
      // Если чат уже в кэше (открывали ранее или префетч) — показываем мгновенно, без спиннера
      const isCached = chatStore.messagesCache.has(chatId.value);
      pendingMessageList.value = !isCached;
      const prefix = `tracker-chat/${chatId.value}/`;
      void fileStore.fetchFiles(prefix).catch(console.log);
      await fetchChatMessages(chatId.value);
      return;
    }
    pendingMessageList.value = true;
    await fetchChatList();
  } catch (error) {
    const statusCode = getErrorStatusCode(error as HttpErrorShape) ?? 500;
    if (statusCode === 404 && chatId.value) {
      raisePageError(404, 'Чат не найден');
      return;
    }
    raisePageError(statusCode, chatId.value ? 'Не удалось загрузить сообщения чата' : 'Не удалось загрузить список чатов');
  } finally {
    pendingMessageList.value = false;
    chatPending.value = false;
  }
};

await loadChatPageData();

watch(
  chatId,
  async (nextChatId, prevChatId) => {
    if (nextChatId === prevChatId) return;
    // Спиннер показываем только если данных ещё нет в кэше
    chatPending.value = !nextChatId || !chatStore.messagesCache.has(nextChatId);
    await loadChatPageData();
  },
  { flush: 'post' },
);

const markOpenChatAsRead = async () => {
  if (!chatId.value) return;
  const chat = chatStore.chatList.find((c) => c.chatId?.toString() === String(chatId.value));
  if (chat && chat.unreadMessagesCount > 0) {
    await chatStore.readChatMessages(String(chatId.value));
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    markOpenChatAsRead();
  }
};

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', markOpenChatAsRead);
  chatPending.value = false;
  await markOpenChatAsRead();
});
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('focus', markOpenChatAsRead);
});

definePageMeta({
  layout: 'default',
  middleware: 'auth',
});
</script>

<template>
  <div class="chat-page">
    <aside :class="['chat-page__sidebar', { 'chat-page__sidebar_hidden': chatId }]">
      <ChatSidebar />
    </aside>
    <main :class="['chat-page__main', { 'chat-page__main_hidden': !chatId }]">
      <ChatView :chat-pending="chatPending" />
    </main>
  </div>
</template>

<style scoped lang="scss">
.chat-page {
  height: 100%;
  width: 100%;
  display: grid;
  grid-template-columns: 340px 1fr;

  @media (max-width: $screen-mobile-l) {
    grid-template-columns: 1fr;
  }

  &__sidebar {
    background-color: var(--dark-text-background-primary);
    height: 100%;
    overflow: auto;

    &_hidden {
      @media (max-width: $screen-mobile-l) {
        display: none;
      }
    }
  }

  &__main {
    position: relative;
    background-color: var(--light-text-backgroung-primary-5);
    overflow: hidden;
    padding: 16px;

    &_hidden {
      @media (max-width: $screen-mobile-l) {
        display: none;
      }
    }
  }
}
</style>
