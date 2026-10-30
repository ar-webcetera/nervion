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
import { PushStatus } from '~/enums/push.enums';
const taskStore = useTaskStore();
const commentStore = useCommentStore();
const userStore = useUserStore();
const tenantStore = useTenantStore();
const notificationStore = useNotificationStore();
const projectStore = useProjectStore();
const { fetchUsers } = userStore;
const { fetchProjects } = projectStore;
const { getKanban, fetchTasks } = taskStore;
const { getAllNotifications } = notificationStore;
const chatStore = useChatStore();
const { fetchChatList, fetchChatMessages } = chatStore;
const timelogStore = useTimelogStore();
const changelogStore = useChangelogStore();

const route = useRoute();
const router = useRouter();
const { $toast } = useNuxtApp();
const selectedMailAccountId = useState<number>('mail-selected-account-id', () => 0);
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
    const mailStore = useMailStore();
    const jobs: Promise<unknown>[] = [getAllNotifications()];
    if (tenantStore.canUse('chat')) jobs.push(fetchChatList());
    if (selectedMailAccountId.value && tenantStore.canUse('mail')) {
      jobs.push(mailStore.fetchAccountUnreadCount(selectedMailAccountId.value));
    }
    await Promise.allSettled(jobs);
  } finally {
    lastSyncAt = Date.now();
    syncUnreadInFlight.value = false;
  }
};

let screenSyncInFlight = false;
const syncScreenState = async () => {
  if (!import.meta.client || !userStore.user?.id || screenSyncInFlight) return;
  screenSyncInFlight = true;
  try {
    const jobs: Promise<unknown>[] = [];

    const openChatId = getSingleQueryValue(route.query.chatId);
    if (openChatId && tenantStore.canUse('chat')) {
      chatStore.messagesCache.delete(openChatId);
      jobs.push(fetchChatMessages(openChatId));
    }

    if (tenantStore.canUse('tasks')) jobs.push(
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
  await useAsyncData(
    'initial-data',
    async () => {
      try {
        return await Promise.all([fetchUsers(), getAllNotifications(),
          ...(tenantStore.canUse('projects') ? [fetchProjects()] : []),
          ...(tenantStore.canUse('chat') ? [fetchChatList()] : []),
        ]);
      } catch (e) {
        console.log(e);
        return null;
      }
    },
    {
      getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
    },
  );
}

const { $webSocket } = useNuxtApp();
const updateTask = (updatedTask: Task) => {
  const applyUpdate = (task: Task, update: Task) => {
    task.status = update.status;
    task.title = update.title;
    task.description = update.description;
    task.priority = update.priority;
    task.responsible_id = update.responsible_id;
    task.story_points = update.story_points;
    task.is_flagged = update.is_flagged;
    task.flag_comment = update.flag_comment;
  };

  if (updatedTask.id === taskStore.currentTask?.id) {
    applyUpdate(taskStore.currentTask, updatedTask);
  }
  const tasks = [...taskStore.tasks, ...taskStore.tasksWithTimelogs];
  for (const task of tasks) {
    if (task.id !== updatedTask.id) continue;
    applyUpdate(task, updatedTask);
  }

  let sourceColumnIndex = -1;
  let sourceCardIndex = -1;
  for (const column of taskStore.kanban) {
    const cardIndex = column.cards.findIndex((card) => card.id === updatedTask.id);
    if (cardIndex === -1) continue;
    sourceColumnIndex = taskStore.kanban.indexOf(column);
    sourceCardIndex = cardIndex;
    break;
  }

  if (sourceColumnIndex === -1 || sourceCardIndex === -1) return;

  const sourceColumn = taskStore.kanban[sourceColumnIndex];
  const card = sourceColumn.cards[sourceCardIndex];
  Object.assign(card, {
    status: updatedTask.status,
    title: updatedTask.title,
    description: extractPlainText(updatedTask.description as TiptapDoc, 80),
    users: updatedTask.responsible?.photo_url ? [updatedTask.responsible.photo_url] : [],
    priority: updatedTask.priority,
    projectName: updatedTask.project?.name,
    taskType: updatedTask.taskType,
    story_points: updatedTask.story_points,
    planned_date: updatedTask.planned_date,
    closed_date: updatedTask.closed_date,
    is_flagged: updatedTask.is_flagged,
    flag_comment: updatedTask.flag_comment,
  });

  if (sourceColumn.status === updatedTask.status) return;

  sourceColumn.cards.splice(sourceCardIndex, 1);
  if (sourceColumn.total !== undefined) {
    sourceColumn.total = Math.max(0, sourceColumn.total - 1);
  }

  const targetColumn = taskStore.kanban.find((column) => column.status === updatedTask.status);
  if (!targetColumn) return;

  const duplicateIndex = targetColumn.cards.findIndex((targetCard) => targetCard.id === updatedTask.id);
  if (duplicateIndex !== -1) {
    targetColumn.cards.splice(duplicateIndex, 1);
  } else if (targetColumn.total !== undefined) {
    targetColumn.total += 1;
  }

  const insertIndex = targetColumn.cards.findIndex((targetCard) => targetCard.priority < card.priority);
  if (insertIndex === -1) {
    targetColumn.cards.push(card);
  } else {
    targetColumn.cards.splice(insertIndex, 0, card);
  }
};

/** Убирает задачу из панели трекера, когда по ней не осталось активных таймлогов */
const dropTaskWithoutActiveTimelog = (taskId: number | null) => {
  if (!taskId) return;
  if (timelogStore.currentTimelogs.some((timelog) => timelog.task_id === taskId)) return;
  taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((task) => task.id !== taskId);
};

const removeTaskLocally = (taskId: number) => {
  taskStore.tasks = taskStore.tasks.filter((t) => t.id !== taskId);
  taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((t) => t.id !== taskId);
  for (const column of taskStore.kanban) {
    column.cards = column.cards.filter((c) => c.id !== taskId);
  }
};

let taskRefetchTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleTaskRefetch = () => {
  if (!import.meta.client) return;
  taskStore.invalidateTasksPage();
  if (route.name !== 'home') return;
  if (taskRefetchTimer) clearTimeout(taskRefetchTimer);
  taskRefetchTimer = setTimeout(() => {
    Promise.allSettled([fetchTasks({ useSavedFilters: true }), getKanban({ useSavedFilters: true })])
      .catch(() => {});
  }, 100);
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
  if (pushStore.status !== PushStatus.Enabled) return;
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
      // Fallback на Notification API ниже.
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
        const tl = event.data as Timelog;
        if (Number(tl?.author_id) !== Number(userStore.user?.id)) break;
        const others = timelogStore.currentTimelogs.filter((t) => t.id !== tl.id);
        timelogStore.currentTimelogs = tl.status === TIMELOG_STATUSES.completed ? others : [...others, tl];
        if (tl.status === TIMELOG_STATUSES.completed) dropTaskWithoutActiveTimelog(tl.task_id);
        break;
      }
      case SOCKET_EVENT_TYPE.timelog_deleted: {
        const tl = event.data as Pick<Timelog, 'id' | 'task_id' | 'author_id'>;
        if (Number(tl?.author_id) !== Number(userStore.user?.id)) break;
        timelogStore.currentTimelogs = timelogStore.currentTimelogs.filter((t) => t.id !== tl.id);
        timelogStore.timelogs = timelogStore.timelogs.filter((t) => t.id !== tl.id);
        dropTaskWithoutActiveTimelog(tl.task_id);
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

const ensureSocketConnected = () => {
  if (!import.meta.client || !$webSocket || !userStore.user?.id) return;

  if (!$webSocket.connected) {
    $webSocket.connect();
  }

  syncPushState();
};

const syncAfterResume = (forceUnread = false) => {
  ensureSocketConnected();
  syncUnreadState(forceUnread).catch(() => {});
  syncScreenState().catch(() => {});
};

const handleDocumentVisibility = () => {
  if (document.visibilityState !== 'visible') return;
  syncAfterResume();
};

const handlePageFocus = () => {
  syncAfterResume();
};

const handlePageShow = (event: PageTransitionEvent) => {
  // bfcache: после «Назад» onMounted не вызывается — обновляем unread принудительно.
  syncAfterResume(event.persisted);
};
const pushStore = usePushStore();
const { showBanner: showNotificationBanner, busy: pushSubscriptionInFlight } = storeToRefs(pushStore);
const syncPushState = () => { void pushStore.sync(); };
const requestNotificationPermission = async () => {
  await pushStore.enable();
  if (pushStore.status === PushStatus.Enabled) $toast.success('Уведомления включены');
  else if (pushStore.status === PushStatus.Blocked) $toast.error('Разрешите уведомления в настройках сайта и Android.');
  else if (pushStore.message) $toast.error(pushStore.message);
};
const dismissNotificationBanner = () => pushStore.dismissBanner();
const handlePushPreferenceChange = (event: StorageEvent) => {
  if (event.key?.startsWith('push-')) { pushStore.reset(); syncPushState(); }
};
watch(
  () => userStore.user?.id ?? null,
  (userId, previousUserId) => {
    if (!import.meta.client) return;
    if (userId !== previousUserId) {
      pushStore.reset();
    }
    if (userId) {
      syncUnreadState(true).catch(() => {});
    }
    syncPushState();
  },
  { immediate: true },
);

onMounted(async () => {
  const yandexNotice = route.query.yandex_notice;
  const yandexError = typeof route.query.yandex_error === 'string' ? route.query.yandex_error : '';
  if (yandexNotice === 'linked') {
    await userStore.fetchMe().catch(console.error);
    $toast.success('Яндекс ID привязан');
  } else if (yandexError) {
    $toast.error(yandexError);
  }
  if (yandexNotice || yandexError) {
    const nextQuery = { ...route.query };
    delete nextQuery.yandex_notice;
    delete nextQuery.yandex_error;
    void router.replace({ query: nextQuery });
  }

  initSocket();
  if (userStore.user) {
    changelogStore.fetchUnseen().catch(console.error);
    if (tenantStore.canUse('chat')) chatStore.prefetchChats().catch(console.error);
  }
  document.addEventListener('visibilitychange', handleDocumentVisibility);
  window.addEventListener('focus', handlePageFocus);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('online', handlePageFocus);
  window.addEventListener('storage', handlePushPreferenceChange);
  syncIntervalId = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    syncPushState();
    syncUnreadState().catch(() => {});
    syncScreenState().catch(() => {});
  }, 30000);
  ensureSocketConnected();
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
  window.removeEventListener('storage', handlePushPreferenceChange);
  destroySocket();
});
</script>

<template>
  <BaseRouteLoader />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <div id="teleports"></div>
  <ChangelogModal />
  <ClientOnly>
    <Transition name="banner">
      <PushNotificationBanner
        v-if="showNotificationBanner"
        :busy="pushSubscriptionInFlight"
        @allow="requestNotificationPermission"
        @dismiss="dismissNotificationBanner"
      />
    </Transition>
  </ClientOnly>
</template>
