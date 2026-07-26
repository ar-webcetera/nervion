import { defineStore } from 'pinia';
import type { MailUnreadCounts } from '@tracker/contracts';
import type {
  MailAccount,
  MailAccountPayload,
  MailAttachmentDescriptor,
  MailMessage,
  MailThread,
  SendMailPayload,
} from '~/types/mail';

interface ThreadsResponse {
  threads: MailThread[];
  total: number;
  page: number;
  limit: number;
}

interface ThreadDetailResponse {
  thread: MailThread;
  messages: MailMessage[];
}

export const useMailStore = defineStore('mail', () => {
  const config = useRuntimeConfig();

  const accounts = ref<MailAccount[]>([]);
  const manageAccounts = ref<MailAccount[]>([]);
  const contacts = ref<string[]>([]);
  const threads = ref<MailThread[]>([]);
  const threadsTotal = ref(0);
  const currentThread = ref<MailThread | null>(null);
  const messages = ref<MailMessage[]>([]);
  const unreadCount = ref(0);
  const inboxUnreadCount = ref(0);
  const trashUnreadCount = ref(0);
  const pendingThreads = ref(false);
  const pendingMessages = ref(false);
  const threadsPage = ref(1);
  const threadsLimit = ref(30);
  let threadsRequestVersion = 0;

  const requestOptions = () => ({
    baseURL: config.public.API_URL as string,
    credentials: 'include' as const,
    headers: useRequestHeaders(['cookie']),
  });

  const fetchAccounts = async () => {
    accounts.value = await $fetch<MailAccount[]>('/api/mailbox/accounts', requestOptions());
    return accounts.value;
  };

  const fetchManageAccounts = async () => {
    manageAccounts.value = await $fetch<MailAccount[]>('/api/mailbox/accounts/manage', requestOptions());
    return manageAccounts.value;
  };

  const fetchThreads = async (
    params: {
      folder?: string;
      account_id?: number;
      search?: string;
      page?: number;
      limit?: number;
      silent?: boolean;
      append?: boolean;
    } = {},
  ) => {
    const requestVersion = params.append ? threadsRequestVersion : ++threadsRequestVersion;
    if (!params.silent) {
      pendingThreads.value = true;
    }
    try {
      const response = await $fetch<ThreadsResponse>('/api/mailbox/threads', {
        ...requestOptions(),
        query: {
          folder: params.folder || undefined,
          account_id: params.account_id || undefined,
          search: params.search || undefined,
          page: params.page || undefined,
          limit: params.limit || undefined,
        },
      });
      if (requestVersion !== threadsRequestVersion) return response;

      if (params.append) {
        const existingIds = new Set(threads.value.map((thread) => thread.id));
        threads.value = [...threads.value, ...response.threads.filter((thread) => !existingIds.has(thread.id))];
      } else {
        threads.value = response.threads;
      }
      threadsTotal.value = response.total;
      threadsPage.value = response.page;
      threadsLimit.value = response.limit;
      return response;
    } finally {
      if (!params.silent) {
        pendingThreads.value = false;
      }
    }
  };

  const moveThreadToFolder = async (threadId: number, folder: 'inbox' | 'trash') => {
    await $fetch(`/api/mailbox/threads/${threadId}/folder`, {
      ...requestOptions(),
      method: 'PATCH',
      body: { folder },
    });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchUnreadCount();
  };

  const deleteThread = async (threadId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}`, { ...requestOptions(), method: 'DELETE' });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchUnreadCount();
  };

  const deleteMessage = async (messageId: number) => {
    await $fetch(`/api/mailbox/messages/${messageId}`, { ...requestOptions(), method: 'DELETE' });
    messages.value = messages.value.filter((item) => item.id !== messageId);
    await fetchUnreadCount();
  };

  const saveDraft = async (payload: {
    account_id: number;
    to?: string[];
    cc?: string[];
    subject?: string;
    html?: string;
    text?: string;
    draft_id?: number;
    attachments?: MailAttachmentDescriptor[];
  }) => {
    return $fetch<MailMessage>('/api/mailbox/drafts', { ...requestOptions(), method: 'POST', body: payload });
  };

  const sendDraft = async (draftId: number) => {
    return $fetch<MailMessage>(`/api/mailbox/drafts/${draftId}/send`, { ...requestOptions(), method: 'POST' });
  };

  const fetchContacts = async () => {
    const response = await $fetch<{ contacts: string[] }>('/api/mailbox/contacts', requestOptions());
    contacts.value = response.contacts;
    return response.contacts;
  };

  const uploadAttachment = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return $fetch<MailAttachmentDescriptor>('/api/mailbox/attachments', {
      baseURL: config.public.API_URL as string,
      credentials: 'include',
      method: 'POST',
      body: formData,
    });
  };

  const fetchThread = async (threadId: number) => {
    pendingMessages.value = true;
    try {
      const response = await $fetch<ThreadDetailResponse>(`/api/mailbox/threads/${threadId}`, requestOptions());
      currentThread.value = response.thread;
      messages.value = response.messages;
      return response;
    } finally {
      pendingMessages.value = false;
    }
  };

  const markThreadRead = async (threadId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}/read`, { ...requestOptions(), method: 'PATCH' });

    const thread =
      threads.value.find((item) => item.id === threadId) ??
      (currentThread.value?.id === threadId ? currentThread.value : null);
    if (thread?.unread_count) {
      if (thread.folder === 'trash') {
        trashUnreadCount.value = Math.max(0, trashUnreadCount.value - thread.unread_count);
      } else {
        const nextInbox = Math.max(0, inboxUnreadCount.value - thread.unread_count);
        inboxUnreadCount.value = nextInbox;
        unreadCount.value = nextInbox;
      }
      thread.unread_count = 0;
    }
  };

  const sendMail = async (payload: SendMailPayload) => {
    const message = await $fetch<MailMessage>('/api/mailbox/send', {
      ...requestOptions(),
      method: 'POST',
      body: payload,
    });

    if (payload.thread_id && currentThread.value?.id === payload.thread_id) {
      messages.value = [...messages.value, message];
    }

    return message;
  };

  const fetchUnreadCount = async () => {
    const response = await $fetch<MailUnreadCounts>('/api/mailbox/unread-count', requestOptions());
    const inbox = Number(response.inbox ?? response.count) || 0;
    const trash = Number(response.trash) || 0;
    inboxUnreadCount.value = inbox;
    trashUnreadCount.value = trash;
    // count всегда = inbox, даже если бэкенд ещё отдаёт сумму по папкам
    unreadCount.value = inbox;
    return response;
  };

  const createAccount = async (payload: MailAccountPayload) => {
    const account = await $fetch<MailAccount>('/api/mailbox/accounts', {
      ...requestOptions(),
      method: 'POST',
      body: payload,
    });
    accounts.value = [...accounts.value, account];
    return account;
  };

  const updateAccount = async (id: number, payload: Partial<MailAccountPayload>) => {
    const account = await $fetch<MailAccount>(`/api/mailbox/accounts/${id}`, {
      ...requestOptions(),
      method: 'PATCH',
      body: payload,
    });
    accounts.value = accounts.value.map((item) => (item.id === id ? account : item));
    return account;
  };

  return {
    accounts,
    manageAccounts,
    fetchManageAccounts,
    threads,
    threadsTotal,
    threadsPage,
    threadsLimit,
    currentThread,
    messages,
    unreadCount,
    inboxUnreadCount,
    trashUnreadCount,
    pendingThreads,
    pendingMessages,
    fetchAccounts,
    fetchThreads,
    fetchThread,
    markThreadRead,
    sendMail,
    fetchUnreadCount,
    createAccount,
    updateAccount,
    moveThreadToFolder,
    deleteThread,
    deleteMessage,
    saveDraft,
    sendDraft,
    uploadAttachment,
    contacts,
    fetchContacts,
  };
});
