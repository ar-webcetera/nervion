<script setup lang="ts">
import type { ChatDeletedEvent, SOCKET_EVENT, UserOnlineEvent, UsersOnlineEvent } from '~/types/socket';
import { SOCKET_EVENT_TYPE } from '~/constants/socket.constants';
import { useTaskStore } from '~/stores/taskStore';
import type { Task, Timelog } from '~/types/task';
import { TIMELOG_STATUSES } from '~/types/task';
import type { Comment } from '~/types/comment';
import type { Notification } from '~/types/notification';
import { TypeSort } from '~/constants/sort.constants';
import type { ChatMessage } from './types/chat';
import { extractPlainText } from '~/utils/extractPainText';
import type { TiptapDoc } from '~/utils/extractPainText';
const taskStore = useTaskStore();
const commentStore = useCommentStore();
const userStore = useUserStore();
const notificationStore = useNotificationStore();
const projectStore = useProjectStore();
const { fetchUsers } = userStore;
const { fetchProjects } = projectStore;
const { getKanban, fetchTasks, getFilterState } = taskStore;
const { getAllNotifications } = notificationStore;
const chatStore = useChatStore();
const { fetchChatList, fetchChatMessages } = chatStore;
const timelogStore = useTimelogStore();
const changelogStore = useChangelogStore();

const route = useRoute();
const router = useRouter();
const syncUnreadInFlight = ref(false);
let lastSyncAt = 0;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

const isStandalonePwaMode = (): boolean => {
  if (!import.meta.client) return false;

  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
};

const syncUnreadState = async (force = false) => {
  if (!userStore.user?.id) return;

  const now = Date.now();
  if (!force && (syncUnreadInFlight.value || now - lastSyncAt < 1500)) return;

  syncUnreadInFlight.value = true;

  try {
    await Promise.allSettled([getAllNotifications(), fetchChatList()]);
  } finally {
    lastSyncAt = Date.now();
    syncUnreadInFlight.value = false;
  }
};

// Догрузка актуального состояния текущего экрана при возврате в приложение/реконнекте.
// Закрывает рассинхрон, когда изменение пришло не от этой вкладки (десктоп-таймер,
// другой девайс) или пока сокет был мёртв в фоне (мобильный браузер).
let screenSyncInFlight = false;
const syncScreenState = async () => {
  if (!import.meta.client || !userStore.user?.id || screenSyncInFlight) return;
  screenSyncInFlight = true;
  try {
    const jobs: Promise<unknown>[] = [];

    // Открытый чат — перезагрузить свежие сообщения (сбросив кэш, иначе вернёт старое)
    const openChatId = getSingleQueryValue(route.query.chatId);
    if (openChatId) {
      chatStore.messagesCache.delete(openChatId);
      jobs.push(fetchChatMessages(openChatId));
    }

    // Список задач и канбан — могли измениться из другого клиента без дошедшего WS-события
    jobs.push(fetchTasks({ useSavedFilters: true }));
    jobs.push(getKanban({ useSavedFilters: true }));

    // Активный таймлог — мог быть остановлен из десктопа или другого устройства
    jobs.push(
      timelogStore
        .findByFilter({
          author_id: userStore.user.id,
          status: [TIMELOG_STATUSES.in_progress, TIMELOG_STATUSES.paused],
        })
        .then((res) => {
          timelogStore.currentTimelogs = res ?? [];
        }),
    );

    await Promise.allSettled(jobs);
  } finally {
    screenSyncInFlight = false;
  }
};

const getSingleQueryValue = (value: string | null | Array<string | null> | undefined) => {
  if (!value) return null;
  return Array.isArray(value) ? (value.find((item) => typeof item === 'string') ?? null) : value;
};

const getPositiveQueryNumber = (value: string | null | Array<string | null> | undefined) => {
  const queryValue = getSingleQueryValue(value);
  if (!queryValue) return null;

  const number = Number(queryValue);
  return Number.isInteger(number) && number > 0 ? number : null;
};

watchEffect(() => {
  const currentTaskId = getPositiveQueryNumber(route.query['task-id']);

  taskStore.currentTaskId = currentTaskId;
  taskStore.currentTaskDate = currentTaskId ? getSingleQueryValue(route.query['task-date']) : null;
});

if (userStore.user) {
  await useAsyncData('initial-data', async () => {
    try {
      return Promise.all([
        getKanban({
          useSavedFilters: true,
        }),
        fetchTasks({
          useSavedFilters: true,
        }),
        fetchUsers(),
        fetchProjects(),
        getFilterState(),
        getAllNotifications(),
        fetchChatList(),
      ]);
    } catch (e) {
      console.log(e);
    }
  });
}

const { $webSocket } = useNuxtApp();
const updateTask = (updateTask: Task) => {
  const applyUpdate = (task: Task, updateTask: Task) => {
    task.status = updateTask.status;
    task.title = updateTask.title;
    task.description = updateTask.description;
    task.priority = updateTask.priority;
    task.responsible_id = updateTask.responsible_id;
    task.story_points = updateTask.story_points;
  };

  if (updateTask.id === taskStore.currentTask?.id) {
    applyUpdate(taskStore.currentTask, updateTask);
  }
  const tasks = [...taskStore.tasks, ...taskStore.tasksWithTimelogs];
  for (const task of tasks) {
    if (task.id !== updateTask.id) continue;
    applyUpdate(task, updateTask);
  }
  for (const column of taskStore.kanban) {
    for (const card of column.cards) {
      if (card.id !== updateTask.id) continue;
      card.status = updateTask.status;
      card.title = updateTask.title;
      card.description = extractPlainText(updateTask.description as TiptapDoc, 80);
      card.users = updateTask.responsible?.photo_url ? [updateTask.responsible.photo_url] : [];
      card.priority = updateTask.priority;
      card.story_points = updateTask.story_points;
    }
  }
};

// Удаление задачи другим клиентом — точечно убираем из списков и канбана (без «призрака»)
const removeTaskLocally = (taskId: number) => {
  taskStore.tasks = taskStore.tasks.filter((t) => t.id !== taskId);
  taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((t) => t.id !== taskId);
  for (const column of taskStore.kanban) {
    column.cards = column.cards.filter((c) => c.id !== taskId);
  }
};

// Новая задача другим клиентом — НЕ вставляем вслепую (нарушит фильтры/порядок/может задвоить),
// а делаем мягкий отложенный refetch, который корректно применит текущие фильтры.
let taskRefetchTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleTaskRefetch = () => {
  if (!import.meta.client) return;
  if (taskRefetchTimer) clearTimeout(taskRefetchTimer);
  taskRefetchTimer = setTimeout(() => {
    Promise.allSettled([fetchTasks({ useSavedFilters: true }), getKanban({ useSavedFilters: true })]).catch(() => {});
  }, 1500);
};

const addComment = (newComment: Comment) => {
  if (taskStore.currentTask?.id !== newComment.task?.id) return;

  if (newComment.comment_id) {
    const parent = commentStore.comments.find((c) => c.id === newComment.comment_id);
    if (!parent) return;
    parent.subComments.push(newComment);
    return;
  }

  const insert = commentStore.sortType === TypeSort.DESC ? commentStore.comments.unshift : commentStore.comments.push;
  insert.call(commentStore.comments, newComment);
};

const updateComment = (newComment: Comment) => {
  if (newComment.comment_id) {
    const comment = commentStore.comments.find((comment) => comment.id === newComment.comment_id);
    if (!comment) return;
    const subComment = comment.subComments.find((subComment) => subComment.id === newComment.id);
    if (!subComment) return;
    subComment.message = newComment.message;
  } else {
    for (const comment of commentStore.comments) {
      if (comment.id === newComment.id) {
        comment.message = newComment.message;
        comment.resolved = newComment.resolved;
      }
    }
  }
};

const deleteComment = (id: number, commentId: number | null = null) => {
  if (commentId) {
    const comment = commentStore.comments.find((comment) => comment.id === id);
    if (!comment) return;
    const index = comment.subComments.findIndex((c) => c.id === commentId);
    if (index !== -1) {
      comment.subComments.splice(index, 1);
    }
  } else {
    const index = commentStore.comments.findIndex((c) => c.id === id);
    if (index !== -1) {
      commentStore.comments.splice(index, 1);
    }
  }
};

const addNotification = (newNotification: Notification) => {
  const audio = new Audio('/icq-sound.mp3');
  audio.volume = 0.5;
  if (Number(userStore.user?.id) === Number(newNotification.recipient.id)) {
    notificationStore.notifications.unshift(newNotification);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
};

const showPushEvent = async (newMessage: ChatMessage) => {
  if (Notification.permission !== 'granted') return;
  const messageText = newMessage.message?.content?.[0]?.content?.[0]?.text || 'Новое сообщение';
  const title = newMessage.author ? `${newMessage.author.first_name} ${newMessage.author.last_name}` : 'Удалённый пользователь';
  const url = `/chat?chatId=${newMessage.chat_id}`;

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: messageText,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: `message-${newMessage.id}`,
        data: { url },
      });
      return;
    } catch {
      // ignore and fallback to Notification API
    }
  }

  const notification = new window.Notification(title, {
    body: messageText,
    icon: '/icon-192x192.png',
    tag: `message-${newMessage.id}`,
  });
  notification.onclick = () => {
    window.focus();
    router.push(url);
    notification.close();
    chatStore.pendingMessageList = true;
    chatStore.fetchChatMessages(String(newMessage.chat_id)).finally(() => {
      chatStore.pendingMessageList = false;
    });
  };
};

const addMessage = (newMessage: ChatMessage) => {
  chatStore.fetchChatList();
  chatStore.addMessageToCache(newMessage.chat_id, newMessage);

  const chatExists = chatStore.chatList.some((chat) => chat.chatId === newMessage.chat_id);
  const isChatOpen = route.query.chatId === newMessage.chat_id;
  const isDocumentVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';

  if (Number(userStore.user?.id) !== Number(newMessage.author?.id) && chatExists) {
    const audio = new Audio('/icq-sound.mp3');
    audio.volume = 0.5;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    if (
      isDocumentVisible &&
      !isChatOpen &&
      !isStandalonePwaMode() &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      showPushEvent(newMessage);
    }
  }
};

// Правим сообщение прямо в кэше нужного чата по message.chat_id (не по маршруту).
// Для открытого чата messages.value и messagesCache.get(chatId) — один и тот же
// реактивный массив, поэтому обновляется и открытый чат, и кэш остальных чатов.
const deleteMessage = (message: ChatMessage) => {
  const cached = chatStore.messagesCache.get(message.chat_id);
  if (!cached) return;
  const index = cached.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    cached.splice(index, 1);
  }
};

const updateMessage = (message: ChatMessage) => {
  const cached = chatStore.messagesCache.get(message.chat_id);
  if (!cached) return;
  const index = cached.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    cached[index] = message;
  }
};

const removeDeletedChat = (deletedChat: ChatDeletedEvent) => {
  if (!deletedChat.memberIds.includes(Number(userStore.user?.id))) return;

  chatStore.removeChatLocally(deletedChat.id);

  if (getSingleQueryValue(route.query.chatId) === deletedChat.id) {
    const query = { ...route.query };
    delete query.chatId;
    void router.replace({ query });
  }
};

const initSocket = () => {
  if (!$webSocket) {
    console.warn('WebSocket не инициализирован');
    return;
  }

  $webSocket.on('event', (event: SOCKET_EVENT) => {
    switch (event.type) {
      case SOCKET_EVENT_TYPE.comment_added: {
        const comment = event.data as Comment;
        addComment(comment);
        break;
      }
      case SOCKET_EVENT_TYPE.comment_updated: {
        const comment = event.data as Comment;
        updateComment(comment);
        break;
      }
      case SOCKET_EVENT_TYPE.comment_deleted: {
        const comment = event.data as Partial<Comment>;
        if (comment.id && !comment.comment_id) {
          deleteComment(comment.id);
        } else if (comment.id && comment.comment_id) {
          deleteComment(comment.id, comment.comment_id);
        }
        break;
      }
      case SOCKET_EVENT_TYPE.notification_added: {
        const notification = event.data as Notification;
        addNotification(notification);
        break;
      }
      case SOCKET_EVENT_TYPE.notification_updated: {
        const notification = event.data as Notification;
        notificationStore.updateLocaleNotification(notification.id, notification);
        break;
      }
      case SOCKET_EVENT_TYPE.task_update: {
        const task = event.data as Task;
        updateTask(task);
        break;
      }
      case SOCKET_EVENT_TYPE.task_added: {
        scheduleTaskRefetch();
        break;
      }
      case SOCKET_EVENT_TYPE.task_deleted: {
        const data = event.data as { id: number };
        if (data?.id) removeTaskLocally(data.id);
        break;
      }
      case SOCKET_EVENT_TYPE.timelog_updated: {
        // Таймлог изменён извне (другая вкладка, десктоп, другое устройство) —
        // апсертим в currentTimelogs; завершённый убираем. UI таймера отреагирует через computed.
        const tl = event.data as Timelog;
        if (Number(tl?.author_id) !== Number(userStore.user?.id)) break;
        const others = timelogStore.currentTimelogs.filter((t) => t.id !== tl.id);
        timelogStore.currentTimelogs = tl.status === TIMELOG_STATUSES.completed ? others : [...others, tl];
        break;
      }
      case SOCKET_EVENT_TYPE.chat_message_added: {
        const message = event.data as ChatMessage;
        addMessage(message);
        break;
      }

      case SOCKET_EVENT_TYPE.chat_message_deleted: {
        const message = event.data as ChatMessage;
        deleteMessage(message);
        break;
      }
      case SOCKET_EVENT_TYPE.chat_message_updated: {
        const message = event.data as ChatMessage;
        updateMessage(message);
        break;
      }
      case SOCKET_EVENT_TYPE.chat_deleted: {
        const deletedChat = event.data as ChatDeletedEvent;
        removeDeletedChat(deletedChat);
        break;
      }
      case SOCKET_EVENT_TYPE.users_online: {
        const data = event.data as UsersOnlineEvent;
        userStore.onlineUserIds = new Set(data.userIds.map(Number));
        break;
      }
      case SOCKET_EVENT_TYPE.user_online: {
        const data = event.data as UserOnlineEvent;
        userStore.onlineUserIds.add(Number(data.userId));
        break;
      }
      case SOCKET_EVENT_TYPE.user_offline: {
        const data = event.data as UserOnlineEvent;
        userStore.onlineUserIds.delete(Number(data.userId));
        break;
      }
    }
  });

  $webSocket.on('connect', () => {
    syncUnreadState(true).catch(() => {});
    syncScreenState().catch(() => {});
  });
};

const destroySocket = () => {
  if ($webSocket) {
    $webSocket.off('event');
    $webSocket.off('connect');
  }
};

const ensureRealtimeSync = () => {
  if (!import.meta.client || !$webSocket || !userStore.user?.id) return;

  if (!$webSocket.connected) {
    $webSocket.connect();
  }

  syncUnreadState().catch(() => {});
  syncScreenState().catch(() => {});
  syncPushState();
};

const handleDocumentVisibility = () => {
  if (document.visibilityState !== 'visible') return;
  ensureRealtimeSync();
};

const handlePageFocus = () => {
  ensureRealtimeSync();
};

const handlePageShow = () => {
  ensureRealtimeSync();
};
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
};

const config = useRuntimeConfig();

const showNotificationBanner = ref(false);
const pushSubscriptionInFlight = ref(false);
const pushSubscriptionUserId = ref<number | null>(null);

const dismissNotificationBanner = () => {
  showNotificationBanner.value = false;
  if (import.meta.client) localStorage.setItem('push-banner-dismissed', '1');
};

const isSubscriptionServerKeyMismatch = (subscription: PushSubscription, expectedServerKey: Uint8Array): boolean => {
  const currentServerKey = subscription.options.applicationServerKey;
  if (!currentServerKey) return false;

  const currentServerKeyBytes = new Uint8Array(currentServerKey);
  if (currentServerKeyBytes.length !== expectedServerKey.length) return true;

  for (let index = 0; index < currentServerKeyBytes.length; index++) {
    if (currentServerKeyBytes[index] !== expectedServerKey[index]) return true;
  }

  return false;
};

const getValidPushSubscription = async (
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array,
): Promise<PushSubscription | null> => {
  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    const existingKeys = existing.toJSON().keys;
    if (existingKeys?.p256dh && existingKeys?.auth && !isSubscriptionServerKeyMismatch(existing, applicationServerKey)) {
      return existing;
    }
    await existing.unsubscribe().catch(() => {});
  }

  const created = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as unknown as BufferSource,
  });
  const createdKeys = created.toJSON().keys;
  if (!createdKeys?.p256dh || !createdKeys?.auth) return null;
  return created;
};

const subscribeToPush = async () => {
  const userId = userStore.user?.id;
  if (!userId || pushSubscriptionInFlight.value || pushSubscriptionUserId.value === userId) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  pushSubscriptionInFlight.value = true;
  try {
    const vapid = await $fetch<{ key: string }>('/api/push/vapid-public-key', { baseURL: config.public.API_URL as string });
    if (!vapid.key) {
      console.warn('Push subscription skipped: empty VAPID public key');
      return;
    }

    const applicationServerKey = urlBase64ToUint8Array(vapid.key);
    const reg = await navigator.serviceWorker.ready;
    const sub = await getValidPushSubscription(reg, applicationServerKey);
    if (!sub) {
      console.warn('Push subscription skipped: subscription keys are missing');
      return;
    }

    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) {
      console.warn('Push subscription skipped: subscription keys are missing');
      return;
    }

    await $fetch('/api/push/subscribe', {
      method: 'POST',
      baseURL: config.public.API_URL as string,
      credentials: 'include',
      body: { endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
    });
    pushSubscriptionUserId.value = userId;
  } catch (e) {
    console.error('Push subscription failed:', e);
  } finally {
    pushSubscriptionInFlight.value = false;
  }
};

// Вызывается по клику пользователя (обязательно для iOS Safari)
const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return;
  showNotificationBanner.value = false;
  if (import.meta.client) localStorage.setItem('push-banner-dismissed', '1');
  const permission = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  if (permission === 'granted') await subscribeToPush();
};

const syncPushState = () => {
  if (!import.meta.client || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    subscribeToPush().catch(() => {});
    return;
  }

  if (Notification.permission === 'default' && userStore.user?.id && !localStorage.getItem('push-banner-dismissed')) {
    showNotificationBanner.value = true;
  }
};

watch(
  () => userStore.user?.id ?? null,
  (userId, previousUserId) => {
    if (!import.meta.client) return;
    if (userId !== previousUserId) pushSubscriptionUserId.value = null;
    if (userId) {
      syncUnreadState(true).catch(() => {});
    }
    syncPushState();
  },
  { immediate: true },
);

onMounted(() => {
  initSocket();
  if (userStore.user) {
    changelogStore.fetchUnseen().catch(console.error);
    // «Телеграм-эффект»: фоном прогреваем кэш сообщений недавних чатов,
    // чтобы первое открытие было мгновенным. Вебсокет затем держит кэш свежим.
    chatStore.prefetchChats().catch(console.error);
  }
  document.addEventListener('visibilitychange', handleDocumentVisibility);
  window.addEventListener('focus', handlePageFocus);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('online', handlePageFocus);
  syncIntervalId = setInterval(() => {
    if (document.visibilityState === 'visible') {
      ensureRealtimeSync();
    }
  }, 30000);
  ensureRealtimeSync();
  syncPushState();
});
onBeforeUnmount(() => {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  document.removeEventListener('visibilitychange', handleDocumentVisibility);
  window.removeEventListener('focus', handlePageFocus);
  window.removeEventListener('pageshow', handlePageShow);
  window.removeEventListener('online', handlePageFocus);
  destroySocket();
});
</script>

<template>
  <NuxtLoadingIndicator color="var(--primary)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <div id="teleports"></div>
  <ChangelogModal />
  <ClientOnly>
    <Transition name="banner">
      <div v-if="showNotificationBanner" class="push-banner">
        <span>Разрешить уведомления о задачах и сообщениях?</span>
        <div class="push-banner__actions">
          <button class="push-banner__allow" @click="requestNotificationPermission">Разрешить</button>
          <button class="push-banner__dismiss" @click="dismissNotificationBanner">Не сейчас</button>
        </div>
      </div>
    </Transition>
  </ClientOnly>
</template>

<style scoped lang="scss">
.push-banner {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: var(--dark-text-background-secondary);
  border: 1px solid var(--border, #3a3a4a);
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 360px;
  width: calc(100% - 32px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 14px;

  &__actions {
    display: flex;
    gap: 8px;
  }

  &__allow {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: none;
    background: var(--primary, #6c63ff);
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }

  &__dismiss {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border, #3a3a4a);
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 13px;
  }
}

.banner-enter-active,
.banner-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}
</style>
