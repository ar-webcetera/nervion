import { defineStore } from 'pinia';
import { MailSystemFolder } from '@tracker/contracts';
import type { MailFolder, MailSpamRuleScope, MailStatsResponse, MailUnreadCounts } from '@tracker/contracts';
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

const normalizeUnreadCounts = (counts: MailUnreadCounts): MailUnreadCounts => {
  const inbox = Number(counts.inbox ?? counts.count) || 0;
  return {
    count: inbox,
    inbox,
    spam: Number(counts.spam) || 0,
    trash: Number(counts.trash) || 0,
  };
};

const decrementUnreadCounts = (counts: MailUnreadCounts, folder: MailSystemFolder, amount: number): MailUnreadCounts => {
  const next = { ...counts };
  if (folder === MailSystemFolder.SPAM) {
    next.spam = Math.max(0, next.spam - amount);
  } else if (folder === MailSystemFolder.TRASH) {
    next.trash = Math.max(0, next.trash - amount);
  } else {
    next.inbox = Math.max(0, next.inbox - amount);
    next.count = next.inbox;
  }
  return next;
};

export const useMailStore = defineStore('mail', () => {
  const config = useRuntimeConfig();
  const apiBaseUrl = useApiBaseUrl();
  const requestHeaders = useRequestHeaders(['cookie']);

  const accounts = ref<MailAccount[]>([]);
  const manageAccounts = ref<MailAccount[]>([]);
  const contacts = ref<string[]>([]);
  const folders = ref<MailFolder[]>([]);
  const threads = ref<MailThread[]>([]);
  const threadsTotal = ref(0);
  const currentThread = ref<MailThread | null>(null);
  const messages = ref<MailMessage[]>([]);
  const accountUnreadCounts = ref<Record<number, MailUnreadCounts>>({});
  const pendingThreads = ref(false);
  const pendingMessages = ref(false);
  const threadsPage = ref(1);
  const threadsLimit = ref(30);
  let threadsRequestVersion = 0;
  const accountUnreadRequestVersions = new Map<number, number>();

  const requestOptions = () => ({
    baseURL: apiBaseUrl,
    credentials: 'include' as const,
    headers: requestHeaders,
  });

  const fetchAccounts = async () => {
    accounts.value = await $fetch<MailAccount[]>('/api/mailbox/accounts', requestOptions());
    return accounts.value;
  };

  const fetchManageAccounts = async () => {
    manageAccounts.value = await $fetch<MailAccount[]>('/api/mailbox/accounts/manage', requestOptions());
    return manageAccounts.value;
  };

  const fetchThreads = async (params: {
    folder?: string;
    custom_folder_id?: number;
    account_id: number;
    search?: string;
    page?: number;
    limit?: number;
    silent?: boolean;
    append?: boolean;
  }) => {
    const requestVersion = params.append ? threadsRequestVersion : ++threadsRequestVersion;
    if (!params.silent) {
      pendingThreads.value = true;
    }
    try {
      const response = await $fetch<ThreadsResponse>('/api/mailbox/threads', {
        ...requestOptions(),
        query: {
          folder: params.folder || undefined,
          custom_folder_id: params.custom_folder_id || undefined,
          account_id: params.account_id,
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

  const fetchFolders = async (accountId: number) => {
    folders.value = await $fetch<MailFolder[]>('/api/mailbox/folders', {
      ...requestOptions(),
      query: { account_id: accountId },
    });
    return folders.value;
  };

  const createFolder = async (accountId: number, name: string) => {
    const folder = await $fetch<MailFolder>('/api/mailbox/folders', {
      ...requestOptions(),
      method: 'POST',
      body: { account_id: accountId, name },
    });
    folders.value = [...folders.value, folder].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return folder;
  };

  const renameFolder = async (folderId: number, name: string) => {
    const folder = await $fetch<MailFolder>(`/api/mailbox/folders/${folderId}`, {
      ...requestOptions(),
      method: 'PATCH',
      body: { name },
    });
    folders.value = folders.value
      .map((item) => (item.id === folderId ? folder : item))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return folder;
  };

  const deleteFolder = async (folderId: number) => {
    await $fetch(`/api/mailbox/folders/${folderId}`, { ...requestOptions(), method: 'DELETE' });
    folders.value = folders.value.filter((item) => item.id !== folderId);
  };

  type FolderTarget = { system_folder: MailSystemFolder } | { custom_folder_id: number };

  const moveThreadToFolder = async (threadId: number, target: FolderTarget, accountId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}/folder`, {
      ...requestOptions(),
      method: 'PATCH',
      body: target,
    });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchAccountUnreadCount(accountId);
  };

  const markThreadSpam = async (threadId: number, scope: MailSpamRuleScope, accountId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}/spam`, {
      ...requestOptions(),
      method: 'POST',
      body: { scope },
    });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchAccountUnreadCount(accountId);
  };

  const markThreadNotSpam = async (threadId: number, accountId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}/not-spam`, { ...requestOptions(), method: 'POST' });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchAccountUnreadCount(accountId);
  };

  const deleteThread = async (threadId: number, accountId: number) => {
    await $fetch(`/api/mailbox/threads/${threadId}`, { ...requestOptions(), method: 'DELETE' });
    threads.value = threads.value.filter((item) => item.id !== threadId);
    threadsTotal.value = Math.max(0, threadsTotal.value - 1);
    await fetchAccountUnreadCount(accountId);
  };

  const deleteMessage = async (messageId: number, accountId: number) => {
    await $fetch(`/api/mailbox/messages/${messageId}`, { ...requestOptions(), method: 'DELETE' });
    messages.value = messages.value.filter((item) => item.id !== messageId);
    await fetchAccountUnreadCount(accountId);
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
      threads.value.find((item) => item.id === threadId) ?? (currentThread.value?.id === threadId ? currentThread.value : null);
    if (thread?.unread_count) {
      const accountCounts = accountUnreadCounts.value[thread.account_id];
      if (accountCounts) {
        accountUnreadRequestVersions.set(thread.account_id, (accountUnreadRequestVersions.get(thread.account_id) ?? 0) + 1);
        accountUnreadCounts.value = {
          ...accountUnreadCounts.value,
          [thread.account_id]: decrementUnreadCounts(accountCounts, thread.folder, thread.unread_count),
        };
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

  const retryMessage = async (messageId: number) => {
    const message = await $fetch<MailMessage>(`/api/mailbox/messages/${messageId}/retry`, {
      ...requestOptions(),
      method: 'POST',
    });
    messages.value = [...messages.value, message];
    return message;
  };

  const fetchAccountUnreadCount = async (accountId: number) => {
    const requestVersion = (accountUnreadRequestVersions.get(accountId) ?? 0) + 1;
    accountUnreadRequestVersions.set(accountId, requestVersion);
    const response = await $fetch<MailUnreadCounts>('/api/mailbox/unread-count', {
      ...requestOptions(),
      query: { account_id: accountId },
    });
    if (accountUnreadRequestVersions.get(accountId) !== requestVersion) return response;

    accountUnreadCounts.value = {
      ...accountUnreadCounts.value,
      [accountId]: normalizeUnreadCounts(response),
    };
    return response;
  };

  const fetchStats = async (params: { account_id?: number; from?: string; to?: string } = {}) => {
    return $fetch<MailStatsResponse>('/api/mailbox/stats', {
      ...requestOptions(),
      query: {
        account_id: params.account_id || undefined,
        from: params.from || undefined,
        to: params.to || undefined,
      },
    });
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
    folders,
    accountUnreadCounts,
    pendingThreads,
    pendingMessages,
    fetchAccounts,
    fetchThreads,
    fetchThread,
    markThreadRead,
    sendMail,
    retryMessage,
    fetchAccountUnreadCount,
    fetchStats,
    createAccount,
    updateAccount,
    moveThreadToFolder,
    markThreadSpam,
    markThreadNotSpam,
    deleteThread,
    deleteMessage,
    saveDraft,
    sendDraft,
    uploadAttachment,
    contacts,
    fetchContacts,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
  };
});
