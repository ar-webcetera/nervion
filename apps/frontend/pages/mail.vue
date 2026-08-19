<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { MailSpamRuleScope, MailSystemFolder, type MailFolder, type MailStatsResponse } from '@tracker/contracts';
import BaseModal from '~/components/BaseModal.vue';
import MailActionIcon from '~/components/Mail/MailActionIcon.vue';
import MailDeliveryBadge from '~/components/Mail/MailDeliveryBadge.vue';
import MailMessageView from '~/components/Mail/MailMessageView.vue';
import { ROLES } from '~/types/user';
import { MAIL_DIRECTIONS, type MailAttachmentDescriptor, type MailMessage, type MailThread } from '~/types/mail';
import { getErrorMessage } from '~/utils/error';
import { useMailStore } from '~/stores/mailStore';
const MAIL_TZ = 'Europe/Moscow';
const mskDay = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MAIL_TZ, day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
const mskTime = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MAIL_TZ, hour: '2-digit', minute: '2-digit' }).format(date);

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin, ROLES.employee],
});

const { $toast } = useNuxtApp();
const mailStore = useMailStore();
const {
  accounts,
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
} = storeToRefs(mailStore);

const route = useRoute();
const router = useRouter();

const syncUrl = () => {
  if (import.meta.server) return;
  const query: Record<string, string> = { folder: currentFolder.value };
  if (selectedAccountId.value) {
    query.account = String(selectedAccountId.value);
  }
  if (selectedThreadId.value) {
    query.thread = String(selectedThreadId.value);
  }
  if (composeMode.value) {
    query.compose = composeThreadId.value ? String(composeThreadId.value) : '1';
  }
  void router.replace({ query });
};

const initialAccount = Number(route.query.account);
const selectedAccountId = useState<number>('mail-selected-account-id', () => 0);
if (Number.isInteger(initialAccount) && initialAccount > 0) {
  selectedAccountId.value = initialAccount;
}
const search = ref('');
const threadsLoadError = useState<string | null>('mail-threads-load-error', () => null);
const initialThread = Number(route.query.thread);
const selectedThreadId = ref<number | null>(Number.isInteger(initialThread) && initialThread > 0 ? initialThread : null);
const replyText = ref('');
const replyTo = ref('');
const replyCc = ref('');
const sendingReply = ref(false);
const replyInput = ref<HTMLTextAreaElement | null>(null);
const replyOpen = ref(false);
const replyAttachInput = ref<HTMLInputElement | null>(null);
const uploadingReplyAttach = ref(false);
let replyAttachmentSession = 0;

interface ReplyAttachment extends MailAttachmentDescriptor {
  previewUrl: string | null;
}

const replyAttachments = ref<ReplyAttachment[]>([]);

const clearReplyAttachments = () => {
  replyAttachmentSession += 1;
  for (const attachment of replyAttachments.value) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
  replyAttachments.value = [];
};

const openReply = async (includeAllRecipients = false) => {
  const recipients = includeAllRecipients ? replyAllRecipients.value : replySenderRecipients.value;
  replyTo.value = recipients.to.join(', ');
  replyCc.value = recipients.cc.join(', ');
  replyOpen.value = true;
  await nextTick();
  replyInput.value?.focus();
  replyInput.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const cancelReply = () => {
  replyOpen.value = false;
  replyText.value = '';
  replyTo.value = '';
  replyCc.value = '';
  clearReplyAttachments();
};

const FOLDERS = [
  { key: 'inbox', label: 'Входящие' },
  { key: 'sent', label: 'Отправленные' },
  { key: 'drafts', label: 'Черновики' },
  { key: 'spam', label: 'Спам' },
  { key: 'trash', label: 'Корзина' },
  { key: 'stats', label: 'Статистика' },
] as const;
type FolderKey = (typeof FOLDERS)[number]['key'];
type CustomFolderKey = `custom-${number}`;
type ViewFolderKey = FolderKey | CustomFolderKey;
type ThreadFolderKey = Exclude<FolderKey, 'stats'>;
const routeFolder = String(route.query.folder ?? '');
const initialFolder: ViewFolderKey =
  FOLDERS.find((item) => item.key === routeFolder)?.key ??
  (/^custom-\d+$/.test(routeFolder) ? (routeFolder as CustomFolderKey) : 'inbox');
const currentFolder = ref<ViewFolderKey>(initialFolder);
const isStatsFolder = computed(() => currentFolder.value === 'stats');
const currentCustomFolderId = computed(() => {
  if (!currentFolder.value.startsWith('custom-')) return null;
  const id = Number(currentFolder.value.slice('custom-'.length));
  return Number.isInteger(id) && id > 0 ? id : null;
});
const selectedAccountUnreadCounts = computed(
  () => accountUnreadCounts.value[selectedAccountId.value] ?? { count: 0, inbox: 0, spam: 0, trash: 0 },
);
const folderUnreadCount = (folder: ViewFolderKey) => {
  if (folder === 'inbox') return selectedAccountUnreadCounts.value.inbox;
  if (folder === 'spam') return selectedAccountUnreadCounts.value.spam;
  if (folder === 'trash') return selectedAccountUnreadCounts.value.trash;
  return 0;
};

// useState, а не ref: статистика грузится ещё на SSR, и обычный ref не переживает гидратацию
const mailStats = useState<MailStatsResponse | null>('mail-stats', () => null);
const pendingStats = ref(false);
const statsFrom = useState<string>('mail-stats-from', () => '');
const statsTo = useState<string>('mail-stats-to', () => '');

const formatStatsDay = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MAIL_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );

const defaultStatsRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toIsoDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MAIL_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  };
  return { from: toIsoDay(from), to: toIsoDay(to) };
};

const loadStats = async () => {
  pendingStats.value = true;
  try {
    if (!statsFrom.value || !statsTo.value) {
      const range = defaultStatsRange();
      statsFrom.value = range.from;
      statsTo.value = range.to;
    }
    mailStats.value = await mailStore.fetchStats({
      account_id: selectedAccountId.value,
      from: statsFrom.value,
      to: statsTo.value,
    });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pendingStats.value = false;
  }
};

const openProblemThread = async (threadId: number) => {
  currentFolder.value = 'sent';
  selectedThreadId.value = threadId;
  await loadThreads();
  await openThreadById(threadId);
};

const composeParam = String(route.query.compose ?? '');
const composeMode = ref(composeParam !== '');
const isDetailOpen = computed(() => composeMode.value || selectedThreadId.value !== null);
const rootStore = useRootStore();
watch(isDetailOpen, (open) => (rootStore.isDetailFullscreen = open), { immediate: true });
onBeforeUnmount(() => (rootStore.isDetailFullscreen = false));

const backToList = () => {
  if (composeMode.value) closeComposer();
  else selectedThreadId.value = null;
};
const composeDraftId = ref<number | null>(null);
const composeThreadId = ref<number | null>(composeParam !== '1' && Number(composeParam) > 0 ? Number(composeParam) : null);

const activeRecipientField = ref<'to' | 'cc' | null>(null);
const recipientSuggestions = computed(() => {
  const field = activeRecipientField.value;
  if (!field) return [];
  const raw = composeForm[field];
  const already = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const last = already[already.length - 1] ?? '';
  return mailStore.contacts
    .filter((contact) => !already.includes(contact) || contact === last)
    .filter((contact) => contact.includes(last))
    .slice(0, 8);
});
const openRecipientList = (field: 'to' | 'cc') => {
  activeRecipientField.value = field;
};
const closeRecipientList = () => {
  setTimeout(() => {
    activeRecipientField.value = null;
  }, 150);
};
const pickRecipient = (field: 'to' | 'cc', contact: string) => {
  const parts = composeForm[field]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  parts.pop();
  parts.push(contact);
  composeForm[field] = `${parts.join(', ')}, `;
  activeRecipientField.value = null;
};
const composeForm = reactive({
  account_id: 0,
  to: '',
  cc: '',
  subject: '',
  text: '',
  attachments: [] as MailAttachmentDescriptor[],
});
const forwardedHtml = ref<string | null>(null);
const forwardedHeader = ref<{ from: string; subject: string } | null>(null);
const sendingCompose = ref(false);
const attachInput = ref<HTMLInputElement | null>(null);
const uploadingAttach = ref(false);

const triggerAttach = () => attachInput.value?.click();

const onFilesPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  uploadingAttach.value = true;
  try {
    for (const file of files) {
      const descriptor = await mailStore.uploadAttachment(file);
      composeForm.attachments.push(descriptor);
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    uploadingAttach.value = false;
    input.value = '';
  }
};

const removeAttachment = (index: number) => {
  composeForm.attachments.splice(index, 1);
};

const formatAttachSize = (size: number) => {
  if (size < 1024) return `${size} Б`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / 1048576).toFixed(1)} МБ`;
};

const triggerReplyAttach = () => replyAttachInput.value?.click();

const onReplyFilesPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;

  const session = replyAttachmentSession;
  uploadingReplyAttach.value = true;
  try {
    for (const file of files) {
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      try {
        const descriptor = await mailStore.uploadAttachment(file);
        if (session !== replyAttachmentSession) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          continue;
        }
        replyAttachments.value.push({ ...descriptor, previewUrl });
      } catch (error) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        throw error;
      }
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    uploadingReplyAttach.value = false;
    input.value = '';
  }
};

const removeReplyAttachment = (index: number) => {
  const [attachment] = replyAttachments.value.splice(index, 1);
  if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textToHtml = (value: string) => `<div>${escapeHtml(value).replace(/\n/g, '<br>')}</div>`;

const forwardedTextSeparator = '\n\n---------- Пересланное письмо ----------';

const buildComposeHtml = () => {
  if (!forwardedHtml.value || !forwardedHeader.value) {
    return composeForm.text ? textToHtml(composeForm.text) : undefined;
  }

  const document = new DOMParser().parseFromString(forwardedHtml.value, 'text/html');
  document.querySelectorAll('script, noscript, [data-nervion-forwarded-header]').forEach((element) => element.remove());

  const intro = composeForm.text.split(forwardedTextSeparator, 1)[0].trim();
  const header = document.createElement('div');
  header.dataset.nervionForwardedHeader = 'true';
  header.style.cssText =
    'margin:0 0 20px;padding:0 0 16px;border-bottom:1px solid #d9d9d9;font:14px/1.5 Arial,sans-serif;color:#222';
  header.innerHTML = `${intro ? `${textToHtml(intro)}<br>` : ''}<div>---------- Пересланное письмо ----------<br>От: ${escapeHtml(
    forwardedHeader.value.from,
  )}<br>Тема: ${escapeHtml(forwardedHeader.value.subject)}</div>`;
  document.body.insertBefore(header, document.body.firstChild);

  return `<!doctype html>${document.documentElement.outerHTML}`;
};

const restoreForwardedHtml = (html: string | null) => {
  if (typeof DOMParser === 'undefined' || !html || !html.includes('data-nervion-forwarded-header')) return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const header = document.querySelector<HTMLElement>('[data-nervion-forwarded-header]');
  if (!header) return null;
  header.remove();
  return `<!doctype html>${document.documentElement.outerHTML}`;
};

const composeIsDirty = () =>
  Boolean(
    composeForm.to.trim() ||
    composeForm.cc.trim() ||
    composeForm.subject.trim() ||
    composeForm.text.trim() ||
    composeForm.attachments.length,
  );

const autosaveDraft = async () => {
  if (!composeMode.value || !composeForm.account_id || !composeIsDirty()) return;
  const split = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const html = buildComposeHtml();
  try {
    const message = await mailStore.saveDraft({
      account_id: composeForm.account_id,
      to: split(composeForm.to),
      cc: split(composeForm.cc),
      subject: composeForm.subject.trim() || undefined,
      text: composeForm.text || undefined,
      html,
      draft_id: composeDraftId.value ?? undefined,
      attachments: composeForm.attachments,
    });
    composeDraftId.value = message.id;
    composeThreadId.value = message.thread_id;
  } catch {
    // Ошибка фонового автосохранения не должна прерывать работу с письмом.
  }
};

let draftDebounce: ReturnType<typeof setTimeout> | null = null;
let draftAutosavePromise: Promise<void> | null = null;

const runDraftAutosave = () => {
  const autosavePromise = autosaveDraft().then(syncUrl);
  draftAutosavePromise = autosavePromise;
  void autosavePromise.finally(() => {
    if (draftAutosavePromise === autosavePromise) draftAutosavePromise = null;
  });
};

const flushDraftAutosave = async () => {
  if (draftDebounce) {
    clearTimeout(draftDebounce);
    draftDebounce = null;
  }
  if (draftAutosavePromise) await draftAutosavePromise;
};

watch(
  () => [
    composeForm.account_id,
    composeForm.to,
    composeForm.cc,
    composeForm.subject,
    composeForm.text,
    composeForm.attachments.length,
  ],
  () => {
    if (!composeMode.value) return;
    if (draftDebounce) clearTimeout(draftDebounce);
    draftDebounce = setTimeout(() => {
      draftDebounce = null;
      runDraftAutosave();
    }, 1500);
  },
);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
const isLoadingMoreThreads = ref(false);
const selectedThreadIds = ref<Set<number>>(new Set());
const selectedThreadsCount = computed(() => selectedThreadIds.value.size);

const threadQuery = () => ({
  folder: (currentCustomFolderId.value ? undefined : currentFolder.value === 'stats' ? 'sent' : currentFolder.value) as
    | ThreadFolderKey
    | undefined,
  custom_folder_id: currentCustomFolderId.value || undefined,
  account_id: selectedAccountId.value,
  search: search.value || undefined,
});

const loadThreads = async () => {
  if (!selectedAccountId.value) return;
  if (isStatsFolder.value) {
    await loadStats();
    return;
  }
  selectedThreadIds.value = new Set();
  threadsLoadError.value = null;
  try {
    await mailStore.fetchThreads(threadQuery());
  } catch (e) {
    threadsLoadError.value = getErrorMessage(e);
    if (import.meta.client) $toast.error(threadsLoadError.value);
  }
};

const toggleThreadSelection = (threadId: number) => {
  const nextSelection = new Set(selectedThreadIds.value);
  if (nextSelection.has(threadId)) nextSelection.delete(threadId);
  else nextSelection.add(threadId);
  selectedThreadIds.value = nextSelection;
};

const clearThreadSelection = () => {
  selectedThreadIds.value = new Set();
};

const loadMoreThreads = async () => {
  if (isLoadingMoreThreads.value || pendingThreads.value || threads.value.length >= threadsTotal.value) return;

  isLoadingMoreThreads.value = true;
  try {
    await mailStore.fetchThreads({
      ...threadQuery(),
      page: threadsPage.value + 1,
      limit: threadsLimit.value,
      append: true,
    });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isLoadingMoreThreads.value = false;
  }
};

const handleThreadsScroll = (event: Event) => {
  const container = event.currentTarget as HTMLElement;
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (distanceToBottom <= 160) void loadMoreThreads();
};

const selectFolder = async (folder: ViewFolderKey) => {
  if (currentFolder.value === folder) return;
  await autosaveDraft();
  composeMode.value = false;
  composeDraftId.value = null;
  composeThreadId.value = null;
  currentFolder.value = folder;
  selectedThreadId.value = null;
  if (folder === 'stats') {
    void loadStats();
  } else {
    void loadThreads();
  }
};

const POLL_INTERVAL_MS = 30000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const pollThreads = () => {
  if (!selectedAccountId.value) return;
  if (!isStatsFolder.value) {
    void mailStore
      .fetchThreads({
        ...threadQuery(),
        limit: Math.max(30, threads.value.length),
        silent: true,
      })
      .catch(() => {});
  }
  void mailStore.fetchAccountUnreadCount(selectedAccountId.value).catch(() => {});
};

const editDraft = (draft: MailMessage) => {
  composeDraftId.value = draft.id;
  composeThreadId.value = draft.thread_id;
  composeForm.account_id = currentThread.value?.account_id ?? composeForm.account_id;
  composeForm.to = draft.to_addresses.map((item) => item.address).join(', ');
  composeForm.cc = draft.cc_addresses.map((item) => item.address).join(', ');
  composeForm.subject = draft.subject ?? '';
  composeForm.text = draft.text_body ?? '';
  forwardedHtml.value = restoreForwardedHtml(draft.html_body);
  forwardedHeader.value = forwardedHtml.value
    ? {
        from: composeForm.text.match(/\nОт: ([^\n]*)/)?.[1] ?? '',
        subject: composeForm.text.match(/\nТема: ([^\n]*)/)?.[1] ?? '',
      }
    : null;
  composeForm.attachments = (draft.attachments ?? []).map((item) => ({
    s3_key: item.s3_key,
    filename: item.filename,
    content_type: item.content_type,
    size: item.size,
    content_id: item.content_id,
    is_inline: item.is_inline,
  }));
  selectedThreadId.value = null;
  composeMode.value = true;
};

const openThreadById = async (id: number, unread = false) => {
  await autosaveDraft();
  composeMode.value = false;
  composeDraftId.value = null;
  composeThreadId.value = null;
  replyText.value = '';
  try {
    await mailStore.fetchThread(id);
    const draft = messages.value.find((message) => message.status === 'draft');
    if (draft) {
      editDraft(draft);
      return;
    }
    selectedThreadId.value = id;
    if (unread) {
      await mailStore.markThreadRead(id);
    }
  } catch {
    selectedThreadId.value = null;
  }
};

let mailboxInitialized = false;
const loadMailPageData = async () => {
  await mailStore.fetchAccounts();
  if (!accounts.value.some((account) => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accounts.value[0]?.id ?? 0;
  }
  if (!selectedAccountId.value) {
    return;
  }
  composeForm.account_id ||= selectedAccountId.value;
  await mailStore.fetchFolders(selectedAccountId.value);
  if (currentCustomFolderId.value && !folders.value.some((folder) => folder.id === currentCustomFolderId.value)) {
    currentFolder.value = 'inbox';
  }
  const tasks: Promise<unknown>[] = [
    isStatsFolder.value ? loadStats() : loadThreads(),
    mailStore.fetchAccountUnreadCount(selectedAccountId.value),
    mailStore.fetchContacts(),
  ];
  if (!isStatsFolder.value && selectedThreadId.value) {
    tasks.push(
      mailStore.fetchThread(selectedThreadId.value).catch(() => {
        selectedThreadId.value = null;
      }),
    );
  } else if (!isStatsFolder.value && composeThreadId.value) {
    tasks.push(
      mailStore.fetchThread(composeThreadId.value).catch(() => {
        composeThreadId.value = null;
        composeMode.value = false;
      }),
    );
  }
  await Promise.allSettled(tasks);

  if (composeMode.value && composeThreadId.value) {
    const draft = messages.value.find((message) => message.status === 'draft');
    if (draft) editDraft(draft);
  }
};

await useAsyncData('mailbox-init', async () => {
  await loadMailPageData();
  return true;
});
mailboxInitialized = true;

onMounted(() => {
  if (selectedThreadId.value) {
    const draft = messages.value.find((message) => message.status === 'draft');
    if (draft) {
      editDraft(draft);
    } else {
      void mailStore.markThreadRead(selectedThreadId.value).catch(() => {});
    }
  } else if (composeMode.value && composeThreadId.value) {
    const draft = messages.value.find((message) => message.status === 'draft');
    if (draft) editDraft(draft);
  }

  pollTimer = setInterval(pollThreads, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  clearReplyAttachments();
  void autosaveDraft();
});

watch(selectedAccountId, async (accountId) => {
  if (!mailboxInitialized || !accountId) return;
  selectedThreadId.value = null;
  if (currentCustomFolderId.value) currentFolder.value = 'inbox';
  composeForm.account_id = accountId;
  try {
    await Promise.all([mailStore.fetchFolders(accountId), mailStore.fetchAccountUnreadCount(accountId)]);
    if (isStatsFolder.value) await loadStats();
    else await loadThreads();
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
});
watch([currentFolder, selectedAccountId, selectedThreadId, composeMode, composeThreadId], syncUrl);

watch(search, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadThreads, 400);
});

const openThread = (thread: MailThread) => openThreadById(thread.id, Boolean(thread.unread_count));

const orderedMessages = computed(() =>
  [...messages.value].sort((first, second) => {
    const dateDifference = new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
    return dateDifference || second.id - first.id;
  }),
);

const lastInboundMessage = computed(() => orderedMessages.value.find((message) => message.direction === MAIL_DIRECTIONS.inbound));

const replyRecipient = computed(() => lastInboundMessage.value?.from_address || currentThread.value?.counterparty_address || '');

const ownMailAddresses = computed(() => {
  const addresses = accounts.value.map((account) => account.address);
  if (currentThread.value?.account?.address) addresses.push(currentThread.value.account.address);
  return new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean));
});

interface ReplyRecipients {
  to: string[];
  cc: string[];
}

const collectReplyAddresses = (includeAllRecipients: boolean): ReplyRecipients => {
  const to: string[] = [];
  const cc: string[] = [];
  const seen = new Set<string>();
  const add = (target: string[], address: string) => {
    const trimmedAddress = address.trim();
    const addressKey = trimmedAddress.toLowerCase();
    if (!trimmedAddress || ownMailAddresses.value.has(addressKey) || seen.has(addressKey)) return;
    seen.add(addressKey);
    target.push(trimmedAddress);
  };

  add(to, replyRecipient.value);
  if (includeAllRecipients && lastInboundMessage.value) {
    for (const recipient of lastInboundMessage.value.to_addresses) add(to, recipient.address);
    for (const recipient of lastInboundMessage.value.cc_addresses) add(cc, recipient.address);
  }

  return { to, cc };
};

const replySenderRecipients = computed(() => collectReplyAddresses(false));
const replyAllRecipients = computed(() => collectReplyAddresses(true));
const hasReplyAllRecipients = computed(() => {
  const senderOnlyCount = replySenderRecipients.value.to.length;
  return replyAllRecipients.value.to.length + replyAllRecipients.value.cc.length > senderOnlyCount;
});

const sendReply = async () => {
  const text = replyText.value.trim();
  const recipients = splitAddresses(replyTo.value);
  const ccRecipients = splitAddresses(replyCc.value);
  if (!recipients.length) {
    $toast.error('Укажите хотя бы одного получателя');
    return;
  }
  if ((!text && !replyAttachments.value.length) || !currentThread.value) return;

  sendingReply.value = true;
  try {
    const subject = currentThread.value.subject.startsWith('Re:')
      ? currentThread.value.subject
      : `Re: ${currentThread.value.subject}`;

    await mailStore.sendMail({
      account_id: currentThread.value.account_id,
      to: recipients,
      cc: ccRecipients.length ? ccRecipients : undefined,
      subject,
      text: text || undefined,
      html: text ? textToHtml(text) : undefined,
      thread_id: currentThread.value.id,
      attachments: replyAttachments.value.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
    });
    replyText.value = '';
    replyTo.value = '';
    replyCc.value = '';
    replyOpen.value = false;
    clearReplyAttachments();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    sendingReply.value = false;
  }
};

watch(selectedThreadId, () => {
  replyOpen.value = false;
  replyText.value = '';
  replyTo.value = '';
  replyCc.value = '';
  clearReplyAttachments();
});

const openComposer = async () => {
  await autosaveDraft();
  composeDraftId.value = null;
  composeThreadId.value = null;
  composeForm.to = '';
  composeForm.cc = '';
  composeForm.subject = '';
  composeForm.text = '';
  composeForm.attachments = [];
  forwardedHtml.value = null;
  forwardedHeader.value = null;
  if (!composeForm.account_id && accounts.value.length) {
    composeForm.account_id = accounts.value[0].id;
  }
  selectedThreadId.value = null;
  composeMode.value = true;
};

const closeComposer = async () => {
  await autosaveDraft();
  composeMode.value = false;
  composeDraftId.value = null;
  composeThreadId.value = null;
  if (currentFolder.value === 'drafts') await loadThreads();
};

const deleteDraft = async () => {
  if (composeDraftId.value === null) return;
  if (!confirm('Удалить черновик?')) return;
  const id = composeDraftId.value;
  if (draftDebounce) {
    clearTimeout(draftDebounce);
    draftDebounce = null;
  }
  composeMode.value = false;
  composeDraftId.value = null;
  composeThreadId.value = null;
  try {
    await mailStore.deleteMessage(id, selectedAccountId.value);
    await loadThreads();
    syncUrl();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const htmlToPlainText = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html');

  document.querySelectorAll('script, style, noscript, template').forEach((element) => element.remove());
  document.querySelectorAll('a[href]').forEach((element) => {
    const href = element.getAttribute('href')?.trim() ?? '';
    const label = element.textContent?.trim() ?? '';
    if (/^(https?:|mailto:)/i.test(href) && !label.includes(href)) {
      element.append(` (${href})`);
    }
  });
  document.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
  document
    .querySelectorAll('address, article, blockquote, div, footer, h1, h2, h3, h4, h5, h6, header, li, p, section, tr')
    .forEach((element) => element.append('\n'));
  document.querySelectorAll('td, th').forEach((element) => element.append('\t'));

  return (document.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const forwardMessage = async (message: MailMessage) => {
  await autosaveDraft();
  composeDraftId.value = null;
  composeThreadId.value = null;
  composeForm.account_id = currentThread.value?.account_id || composeForm.account_id || (accounts.value[0]?.id ?? 0);
  composeForm.to = '';
  composeForm.cc = '';
  const subject = message.subject || '';
  composeForm.subject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
  const body = message.text_body?.trim() || (message.html_body ? htmlToPlainText(message.html_body) : '');
  composeForm.text = `${forwardedTextSeparator}\nОт: ${message.from_address}\nТема: ${subject}\n\n${body}`;
  forwardedHtml.value = message.html_body;
  forwardedHeader.value = message.html_body ? { from: message.from_address, subject } : null;
  composeForm.attachments = (message.attachments ?? []).map((item) => ({
    s3_key: item.s3_key,
    filename: item.filename,
    content_type: item.content_type,
    size: item.size,
    content_id: item.content_id,
    is_inline: item.is_inline,
  }));
  selectedThreadId.value = null;
  composeMode.value = true;
};

const sendCompose = async () => {
  const recipients = splitAddresses(composeForm.to);
  const ccRecipients = splitAddresses(composeForm.cc);

  if (!composeForm.account_id || !recipients.length || !composeForm.subject.trim()) {
    $toast.error('Заполните ящик, получателя и тему');
    return;
  }

  sendingCompose.value = true;
  try {
    await flushDraftAutosave();
    if (composeDraftId.value) {
      await mailStore.saveDraft({
        account_id: composeForm.account_id,
        to: recipients,
        cc: ccRecipients,
        subject: composeForm.subject.trim(),
        text: composeForm.text,
        html: buildComposeHtml(),
        draft_id: composeDraftId.value,
        attachments: composeForm.attachments,
      });
      await mailStore.sendDraft(composeDraftId.value);
    } else {
      await mailStore.sendMail({
        account_id: composeForm.account_id,
        to: recipients,
        cc: ccRecipients.length ? ccRecipients : undefined,
        subject: composeForm.subject.trim(),
        text: composeForm.text,
        html: buildComposeHtml(),
        attachments: composeForm.attachments.length ? composeForm.attachments : undefined,
      });
    }
    composeMode.value = false;
    composeDraftId.value = null;
    composeThreadId.value = null;
    await loadThreads();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    sendingCompose.value = false;
  }
};

const splitAddresses = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const savingDraft = ref(false);
const saveDraftAction = async () => {
  if (!composeForm.account_id) {
    $toast.error('Выберите ящик');
    return;
  }
  savingDraft.value = true;
  try {
    await mailStore.saveDraft({
      account_id: composeForm.account_id,
      to: splitAddresses(composeForm.to),
      cc: splitAddresses(composeForm.cc),
      subject: composeForm.subject.trim() || undefined,
      text: composeForm.text || undefined,
      html: buildComposeHtml(),
      draft_id: composeDraftId.value ?? undefined,
      attachments: composeForm.attachments,
    });
    composeDraftId.value = null;
    composeThreadId.value = null;
    composeMode.value = false;
    if (currentFolder.value === 'drafts') await loadThreads();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    savingDraft.value = false;
  }
};

const showFolderCreator = ref(false);
const newFolderName = ref('');
const savingFolder = ref(false);

const createFolder = async () => {
  const name = newFolderName.value.trim();
  if (!name || !selectedAccountId.value) return;
  savingFolder.value = true;
  try {
    const folder = await mailStore.createFolder(selectedAccountId.value, name);
    newFolderName.value = '';
    showFolderCreator.value = false;
    await selectFolder(`custom-${folder.id}`);
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    savingFolder.value = false;
  }
};

const renameFolder = async (folder: MailFolder) => {
  const name = prompt('Новое название папки', folder.name)?.trim();
  if (!name || name === folder.name) return;
  try {
    await mailStore.renameFolder(folder.id, name);
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
};

const removeFolder = async (folder: MailFolder) => {
  if (!confirm(`Удалить папку «${folder.name}»? Письма вернутся во «Входящие».`)) return;
  try {
    await mailStore.deleteFolder(folder.id);
    if (currentCustomFolderId.value === folder.id) await selectFolder('inbox');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
};

const moveTarget = ref('');
const movingThreads = ref(false);
const moveModal = ref<InstanceType<typeof BaseModal> | null>(null);
const moveThreadIds = ref<number[]>([]);

const folderTarget = (value: string) => {
  if (value.startsWith('custom-')) return { custom_folder_id: Number(value.slice('custom-'.length)) };
  return { system_folder: value as MailSystemFolder };
};

const moveThreads = async (threadIds: number[]) => {
  if (!moveTarget.value || !selectedAccountId.value || !threadIds.length) return false;
  movingThreads.value = true;
  try {
    if (moveTarget.value === MailSystemFolder.SPAM) {
      await Promise.all(
        threadIds.map((threadId) => mailStore.markThreadSpam(threadId, MailSpamRuleScope.SENDER, selectedAccountId.value)),
      );
    } else {
      await Promise.all(
        threadIds.map((threadId) =>
          mailStore.moveThreadToFolder(threadId, folderTarget(moveTarget.value), selectedAccountId.value),
        ),
      );
    }
    if (selectedThreadId.value && threadIds.includes(selectedThreadId.value)) selectedThreadId.value = null;
    clearThreadSelection();
    moveTarget.value = '';
    return true;
  } catch (error) {
    $toast.error(getErrorMessage(error));
    return false;
  } finally {
    movingThreads.value = false;
  }
};

const openMoveDialog = (threadIds: number[]) => {
  if (!threadIds.length) return;
  moveTarget.value = '';
  moveThreadIds.value = [...threadIds];
  moveModal.value?.open();
};

const askMoveSelectedThreads = () => openMoveDialog([...selectedThreadIds.value]);

const askMoveCurrentThread = () => {
  if (!currentThread.value) return;
  openMoveDialog([currentThread.value.id]);
};

const resetMoveDialog = () => {
  if (movingThreads.value) return;
  moveTarget.value = '';
  moveThreadIds.value = [];
};

const confirmMoveThreads = async () => {
  if (!(await moveThreads(moveThreadIds.value))) return;
  moveModal.value?.close();
  moveThreadIds.value = [];
};

const spamSenderAddress = computed(() => lastInboundMessage.value?.from_address ?? '');
const spamSenderDomain = computed(() => spamSenderAddress.value.split('@').at(-1)?.toLowerCase() ?? '');
const spamConfirmModal = ref<InstanceType<typeof BaseModal> | null>(null);
const spamConfirmScope = ref<MailSpamRuleScope | null>(null);

const askMarkCurrentThreadSpam = (scope: MailSpamRuleScope) => {
  if (!currentThread.value || !selectedAccountId.value) return;
  spamConfirmScope.value = scope;
  spamConfirmModal.value?.open();
};

const resetSpamDialog = () => {
  if (!movingThreads.value) spamConfirmScope.value = null;
};

const confirmCurrentThreadSpam = async () => {
  if (!currentThread.value || !selectedAccountId.value || !spamConfirmScope.value) return;
  const scope = spamConfirmScope.value;
  movingThreads.value = true;
  try {
    await mailStore.markThreadSpam(currentThread.value.id, scope, selectedAccountId.value);
    selectedThreadId.value = null;
    $toast.success(scope === MailSpamRuleScope.DOMAIN ? 'Домен добавлен в спам' : 'Отправитель добавлен в спам');
    spamConfirmModal.value?.close();
    spamConfirmScope.value = null;
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    movingThreads.value = false;
  }
};

const markCurrentThreadNotSpam = async () => {
  if (!currentThread.value || !selectedAccountId.value) return;
  movingThreads.value = true;
  try {
    await mailStore.markThreadNotSpam(currentThread.value.id, selectedAccountId.value);
    selectedThreadId.value = null;
    $toast.success('Переписка возвращена во Входящие');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    movingThreads.value = false;
  }
};

const retryingMessageIds = ref<Set<number>>(new Set());
const retryMessage = async (message: MailMessage) => {
  if (retryingMessageIds.value.has(message.id)) return;
  retryingMessageIds.value = new Set(retryingMessageIds.value).add(message.id);
  try {
    await mailStore.retryMessage(message.id);
    $toast.success('Письмо отправлено повторно');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    const next = new Set(retryingMessageIds.value);
    next.delete(message.id);
    retryingMessageIds.value = next;
  }
};

const confirmModal = ref<InstanceType<typeof BaseModal> | null>(null);
type DeleteTarget =
  | { kind: 'thread' | 'message'; permanent: boolean; id: number; label: string }
  | { kind: 'threads'; permanent: boolean; ids: number[] };
const deleteTarget = ref<DeleteTarget | null>(null);
const isDeleting = ref(false);
const isTrashFolder = computed(() => currentFolder.value === 'trash');

const askDeleteThread = () => {
  if (!currentThread.value) return;
  deleteTarget.value = {
    kind: 'thread',
    permanent: isTrashFolder.value,
    id: currentThread.value.id,
    label: currentThread.value.subject,
  };
  confirmModal.value?.open();
};

const askDeleteMessage = (message: { id: number; subject: string | null; from_address: string }) => {
  deleteTarget.value = {
    kind: 'message',
    permanent: true,
    id: message.id,
    label: message.subject || `письмо от ${message.from_address}`,
  };
  confirmModal.value?.open();
};

const askDeleteSelectedThreads = () => {
  if (!selectedThreadsCount.value) return;
  deleteTarget.value = {
    kind: 'threads',
    permanent: isTrashFolder.value,
    ids: [...selectedThreadIds.value],
  };
  confirmModal.value?.open();
};

const confirmDelete = async () => {
  if (!deleteTarget.value || isDeleting.value) return;
  isDeleting.value = true;
  try {
    if (deleteTarget.value.kind === 'threads') {
      const selectedIds = deleteTarget.value.ids;
      if (deleteTarget.value.permanent) {
        await Promise.all(selectedIds.map((threadId) => mailStore.deleteThread(threadId, selectedAccountId.value)));
      } else {
        await Promise.all(
          selectedIds.map((threadId) =>
            mailStore.moveThreadToFolder(threadId, { system_folder: MailSystemFolder.TRASH }, selectedAccountId.value),
          ),
        );
      }
      if (selectedThreadId.value && selectedIds.includes(selectedThreadId.value)) selectedThreadId.value = null;
      clearThreadSelection();
    } else if (deleteTarget.value.kind === 'message') {
      await mailStore.deleteMessage(deleteTarget.value.id, selectedAccountId.value);
    } else if (deleteTarget.value.permanent) {
      await mailStore.deleteThread(deleteTarget.value.id, selectedAccountId.value);
      selectedThreadId.value = null;
    } else {
      await mailStore.moveThreadToFolder(
        deleteTarget.value.id,
        { system_folder: MailSystemFolder.TRASH },
        selectedAccountId.value,
      );
      selectedThreadId.value = null;
    }
    confirmModal.value?.close();
    deleteTarget.value = null;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isDeleting.value = false;
  }
};

const restoreThread = async () => {
  if (!currentThread.value) return;
  try {
    await mailStore.moveThreadToFolder(
      currentThread.value.id,
      { system_folder: MailSystemFolder.INBOX },
      selectedAccountId.value,
    );
    selectedThreadId.value = null;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const threadDraft = computed(() => messages.value.find((message) => message.status === 'draft'));
const sendThreadDraft = async () => {
  if (!threadDraft.value || !currentThread.value) return;
  try {
    await mailStore.sendDraft(threadDraft.value.id);
    await mailStore.fetchThread(currentThread.value.id);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const accountLabel = (accountId: number) => {
  const account = accounts.value.find((item) => item.id === accountId);
  return account?.address ?? '';
};

const threadDate = (value: string) => {
  const date = new Date(value);
  return mskDay(date) === mskDay(new Date()) ? mskTime(date) : mskDay(date);
};

const avatarInitials = (address: string | null) => {
  if (!address) return '?';
  const local = address.split('@')[0] || address;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
};

const avatarColor = (address: string | null) => {
  const source = address || '?';
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = source.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}deg 48% 42%)`;
};

const gravatarHash = ref<Record<string, string>>({});
const brokenAvatars = ref<Set<string>>(new Set());

const normalizeAddress = (address: string | null) => (address || '').trim().toLowerCase();

const ensureGravatar = async (address: string | null) => {
  if (!import.meta.client) return;
  const key = normalizeAddress(address);
  if (!key || gravatarHash.value[key] !== undefined || !globalThis.crypto?.subtle) return;
  try {
    const data = new TextEncoder().encode(key);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    gravatarHash.value[key] = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    gravatarHash.value[key] = '';
  }
};

const avatarUrl = (address: string | null) => {
  const key = normalizeAddress(address);
  const hash = gravatarHash.value[key];
  if (!hash || brokenAvatars.value.has(key)) return '';
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=80`;
};

const threadAvatarUrl = (thread: MailThread) => {
  const key = normalizeAddress(thread.counterparty_address);
  if (thread.counterparty_avatar_url && !brokenAvatars.value.has(key)) {
    return thread.counterparty_avatar_url;
  }
  return avatarUrl(thread.counterparty_address);
};

const onAvatarError = (address: string | null) => {
  const key = normalizeAddress(address);
  if (!key) return;
  brokenAvatars.value = new Set(brokenAvatars.value).add(key);
};

watch(
  threads,
  (list) => {
    (list || []).forEach((thread) => ensureGravatar(thread.counterparty_address));
    const availableIds = new Set((list || []).map((thread) => thread.id));
    const availableSelection = new Set([...selectedThreadIds.value].filter((threadId) => availableIds.has(threadId)));
    if (availableSelection.size !== selectedThreadIds.value.size) selectedThreadIds.value = availableSelection;
  },
  { immediate: true },
);
</script>

<template>
  <div class="mail-page" :class="{ 'mail-page_detail-open': isDetailOpen }">
    <div class="mail-page__folders">
      <h1 class="mail-page__title">Почта</h1>
      <button class="mail-page__compose-btn mail-page__compose-btn_block" :disabled="!selectedAccountId" @click="openComposer">
        Написать
      </button>
      <nav class="mail-page__folder-nav">
        <button
          v-for="folder in FOLDERS"
          :key="folder.key"
          :class="['mail-page__folder', { 'mail-page__folder_active': currentFolder === folder.key }]"
          :aria-label="
            folderUnreadCount(folder.key) ? `${folder.label}, непрочитанных: ${folderUnreadCount(folder.key)}` : folder.label
          "
          @click="selectFolder(folder.key)"
        >
          <span>{{ folder.label }}</span>
          <span v-if="folderUnreadCount(folder.key)" class="mail-page__folder-badge">
            {{ folderUnreadCount(folder.key) }}
          </span>
        </button>
      </nav>
      <div class="mail-page__custom-folders">
        <div class="mail-page__custom-folders-heading">
          <span>Мои папки</span>
          <button
            type="button"
            class="mail-page__folder-add"
            aria-label="Создать папку"
            title="Создать папку"
            @click="showFolderCreator = !showFolderCreator"
          >
            +
          </button>
        </div>
        <form v-if="showFolderCreator" class="mail-page__folder-form" @submit.prevent="createFolder">
          <input v-model="newFolderName" class="mail-page__folder-input" maxlength="80" placeholder="Название папки" autofocus />
          <button class="mail-page__folder-save" type="submit" :disabled="savingFolder || !newFolderName.trim()">
            {{ savingFolder ? '…' : 'Создать' }}
          </button>
        </form>
        <div v-for="folder in folders" :key="folder.id" class="mail-page__custom-folder-row">
          <button
            type="button"
            :class="[
              'mail-page__folder mail-page__custom-folder-name',
              { 'mail-page__folder_active': currentFolder === `custom-${folder.id}` },
            ]"
            @click="selectFolder(`custom-${folder.id}`)"
          >
            {{ folder.name }}
          </button>
          <button class="mail-page__folder-action" type="button" title="Переименовать" @click="renameFolder(folder)">✎</button>
          <button class="mail-page__folder-action" type="button" title="Удалить" @click="removeFolder(folder)">×</button>
        </div>
      </div>
    </div>

    <div class="mail-page__list">
      <div class="mail-page__filters">
        <select v-model.number="selectedAccountId" class="mail-page__select">
          <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.address }}</option>
        </select>
        <template v-if="isStatsFolder">
          <input v-model="statsFrom" class="mail-page__search mail-page__search_date" type="date" aria-label="Дата с" />
          <input v-model="statsTo" class="mail-page__search mail-page__search_date" type="date" aria-label="Дата по" />
          <button class="mail-page__compose-btn" type="button" :disabled="pendingStats" @click="loadStats">Показать</button>
        </template>
        <template v-else>
          <input v-model="search" class="mail-page__search" type="text" placeholder="Поиск по теме или адресу" />
          <button class="mail-page__compose-btn mail-page__compose-mobile" @click="openComposer">Написать</button>
        </template>
      </div>

      <div v-if="isStatsFolder" class="mail-page__stats">
        <div v-if="pendingStats && !mailStats" class="mail-page__placeholder">Загрузка статистики…</div>
        <template v-else-if="mailStats">
          <p class="mail-page__stats-period">{{ formatStatsDay(mailStats.from) }} - {{ formatStatsDay(mailStats.to) }}</p>
          <div class="mail-page__stats-grid">
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.sent }}</span>
              <span class="mail-page__stats-label">отправлено</span>
            </div>
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.delivered }}</span>
              <span class="mail-page__stats-label">доставлено</span>
            </div>
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.opened }}</span>
              <span class="mail-page__stats-label">открыто · {{ mailStats.totals.open_rate }}%</span>
            </div>
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.clicked }}</span>
              <span class="mail-page__stats-label">клики · {{ mailStats.totals.click_rate }}%</span>
            </div>
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.bounced }}</span>
              <span class="mail-page__stats-label">bounce · {{ mailStats.totals.bounce_rate }}%</span>
            </div>
            <div class="mail-page__stats-card">
              <span class="mail-page__stats-value">{{ mailStats.totals.complained }}</span>
              <span class="mail-page__stats-label">жалобы · {{ mailStats.totals.complaint_rate }}%</span>
            </div>
          </div>
          <p class="mail-page__stats-note">
            Открытия считаются по трекинг-pixel Postbox и не равны "прочитано". Папку "Спам" провайдеры не отдают: видна только
            жалоба, если она пришла.
          </p>
          <h3 class="mail-page__stats-heading">По ящикам</h3>
          <div v-if="!mailStats.by_account.length" class="mail-page__placeholder">За период отправок нет</div>
          <div v-else class="mail-page__stats-accounts">
            <div v-for="row in mailStats.by_account" :key="row.account_id" class="mail-page__stats-account">
              <span class="mail-page__stats-account-name">{{ row.display_name || row.address }}</span>
              <span class="mail-page__stats-account-meta">
                {{ row.sent }} отпр. · {{ row.opened }} откр. · {{ row.bounced }} bounce · {{ row.complained }} жалоб
              </span>
            </div>
          </div>
          <h3 class="mail-page__stats-heading">Проблемные письма</h3>
          <div v-if="!mailStats.problems.length" class="mail-page__placeholder">Bounce и жалоб за период нет</div>
          <button
            v-for="item in mailStats.problems"
            :key="item.id"
            type="button"
            class="mail-page__stats-problem"
            @click="openProblemThread(item.thread_id)"
          >
            <span class="mail-page__stats-problem-top">
              <span class="mail-page__stats-problem-subject">{{ item.subject || '(без темы)' }}</span>
              <MailDeliveryBadge status="sent" :delivery-status="item.delivery_status" :open-count="0" :click-count="0" compact />
            </span>
            <span class="mail-page__stats-problem-meta">
              {{ item.account_address }} → {{ item.to_addresses.join(', ') || '—' }}
            </span>
          </button>
        </template>
        <div v-else class="mail-page__placeholder">Не удалось загрузить статистику</div>
      </div>

      <template v-else>
        <div
          v-if="selectedThreadsCount"
          class="mail-page__selection-bar"
          role="group"
          aria-label="Действия с выбранными письмами"
        >
          <span class="mail-page__selection-count">
            Выбрано: <strong>{{ selectedThreadsCount }}</strong>
          </span>
          <div class="mail-page__selection-actions">
            <button
              class="mail-page__action-button"
              type="button"
              :disabled="movingThreads"
              aria-label="Переместить выбранные письма"
              title="Переместить"
              @click="askMoveSelectedThreads"
            >
              <MailActionIcon name="move" />
            </button>
            <button
              class="mail-page__action-button mail-page__action-button_danger"
              type="button"
              :aria-label="isTrashFolder ? 'Удалить выбранные письма навсегда' : 'Удалить выбранные письма'"
              :title="isTrashFolder ? 'Удалить навсегда' : 'Удалить'"
              @click="askDeleteSelectedThreads"
            >
              <MailActionIcon name="delete" />
            </button>
          </div>
        </div>

        <div class="mail-page__threads" @scroll.passive="handleThreadsScroll">
          <div v-if="pendingThreads && !threads.length" class="mail-page__placeholder">Загрузка…</div>
          <div
            v-else-if="threadsLoadError && !threads.length"
            class="mail-page__placeholder mail-page__placeholder_error"
            role="alert"
          >
            <span>Не удалось загрузить письма</span>
            <button type="button" class="mail-page__retry" @click="loadThreads">Повторить</button>
          </div>
          <div v-else-if="!threads.length" class="mail-page__placeholder">Писем пока нет</div>
          <div
            v-for="thread in threads"
            :key="thread.id"
            :class="[
              'mail-page__thread',
              {
                'mail-page__thread_active': thread.id === selectedThreadId,
                'mail-page__thread_selected': selectedThreadIds.has(thread.id),
              },
            ]"
            role="button"
            tabindex="0"
            @click="openThread(thread)"
            @keydown.enter.self="openThread(thread)"
          >
            <button
              type="button"
              class="mail-page__thread-avatar"
              :style="threadAvatarUrl(thread) ? {} : { backgroundColor: avatarColor(thread.counterparty_address) }"
              :aria-label="selectedThreadIds.has(thread.id) ? 'Снять выбор' : 'Выбрать письмо'"
              :aria-pressed="selectedThreadIds.has(thread.id)"
              @click.stop="toggleThreadSelection(thread.id)"
            >
              <svg
                v-if="selectedThreadIds.has(thread.id)"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 12.5l4 4L19 7"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <img
                v-else-if="threadAvatarUrl(thread)"
                :src="threadAvatarUrl(thread)"
                class="mail-page__thread-avatar-img"
                alt=""
                loading="lazy"
                @error="onAvatarError(thread.counterparty_address)"
              />
              <template v-else>{{ avatarInitials(thread.counterparty_address) }}</template>
            </button>
            <span class="mail-page__thread-body">
              <span class="mail-page__thread-top">
                <span class="mail-page__thread-counterparty">{{ thread.counterparty_address }}</span>
                <span class="mail-page__thread-date">{{ threadDate(thread.list_activity_at || thread.last_message_at) }}</span>
              </span>
              <span class="mail-page__thread-bottom">
                <span :class="['mail-page__thread-subject', { 'mail-page__thread-subject_unread': thread.unread_count }]">
                  {{ thread.subject }}
                </span>
                <MailDeliveryBadge
                  v-if="currentFolder === 'sent'"
                  status="sent"
                  :delivery-status="thread.delivery_status"
                  :open-count="thread.open_count"
                  :click-count="thread.click_count"
                  compact
                />
                <span v-if="thread.unread_count" class="mail-page__thread-badge">{{ thread.unread_count }}</span>
              </span>
            </span>
          </div>
          <div v-if="isLoadingMoreThreads" class="mail-page__load-more">Загружаем ещё…</div>
        </div>
      </template>
    </div>

    <div class="mail-page__detail">
      <template v-if="isStatsFolder">
        <div class="mail-page__detail-empty">
          <p>Сводка по исходящим письмам из ящиков, к которым у вас есть доступ.</p>
          <p class="mail-page__detail-empty-hint">Проблемное письмо из списка слева откроется в "Отправленных".</p>
        </div>
      </template>
      <template v-else-if="composeMode">
        <div class="mail-page__detail-header">
          <button class="mail-page__back-mobile" title="Назад" @click="closeComposer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <h2 class="mail-page__detail-subject">Новое письмо</h2>
          <button class="mail-page__icon-btn mail-page__icon-btn_desktop" @click="closeComposer">Закрыть</button>
        </div>
        <div class="mail-page__compose">
          <label class="mail-composer__label">
            От кого
            <select v-model.number="composeForm.account_id" class="mail-page__select">
              <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.address }}</option>
            </select>
          </label>
          <label class="mail-composer__label">
            Кому (через запятую)
            <div class="mail-page__combobox">
              <input
                v-model="composeForm.to"
                class="mail-page__search"
                type="text"
                placeholder="client@example.com"
                autocomplete="off"
                @focus="openRecipientList('to')"
                @input="openRecipientList('to')"
                @blur="closeRecipientList"
              />
              <ul v-if="activeRecipientField === 'to' && recipientSuggestions.length" class="mail-page__combobox-list">
                <li
                  v-for="contact in recipientSuggestions"
                  :key="contact"
                  class="mail-page__combobox-option"
                  @mousedown.prevent="pickRecipient('to', contact)"
                >
                  {{ contact }}
                </li>
              </ul>
            </div>
          </label>
          <label class="mail-composer__label">
            Копия (через запятую, необязательно)
            <div class="mail-page__combobox">
              <input
                v-model="composeForm.cc"
                class="mail-page__search"
                type="text"
                placeholder="copy@example.com"
                autocomplete="off"
                @focus="openRecipientList('cc')"
                @input="openRecipientList('cc')"
                @blur="closeRecipientList"
              />
              <ul v-if="activeRecipientField === 'cc' && recipientSuggestions.length" class="mail-page__combobox-list">
                <li
                  v-for="contact in recipientSuggestions"
                  :key="contact"
                  class="mail-page__combobox-option"
                  @mousedown.prevent="pickRecipient('cc', contact)"
                >
                  {{ contact }}
                </li>
              </ul>
            </div>
          </label>
          <label class="mail-composer__label">
            Тема
            <input v-model="composeForm.subject" class="mail-page__search" type="text" />
          </label>
          <label class="mail-composer__label mail-composer__label_grow">
            Текст
            <textarea v-model="composeForm.text" class="mail-page__reply-input mail-page__compose-textarea" />
          </label>

          <div v-if="composeForm.attachments.length" class="mail-page__attach-list">
            <div v-for="(att, index) in composeForm.attachments" :key="index" class="mail-page__attach-item">
              <span class="mail-page__attach-name">{{ att.filename }}</span>
              <span class="mail-page__attach-size">{{ formatAttachSize(att.size) }}</span>
              <button class="mail-page__attach-remove" title="Убрать" @click="removeAttachment(index)">×</button>
            </div>
          </div>

          <div class="mail-composer__actions">
            <input ref="attachInput" type="file" multiple hidden @change="onFilesPicked" />
            <button class="mail-page__icon-btn" :disabled="uploadingAttach" @click="triggerAttach">
              {{ uploadingAttach ? 'Загрузка…' : 'Прикрепить файл' }}
            </button>
            <button class="mail-page__icon-btn" :disabled="savingDraft" @click="saveDraftAction">
              {{ savingDraft ? 'Сохранение…' : 'Сохранить черновик' }}
            </button>
            <button v-if="composeDraftId !== null" class="mail-page__icon-btn mail-page__icon-btn_danger" @click="deleteDraft">
              Удалить
            </button>
            <button class="mail-page__compose-btn" :disabled="sendingCompose" @click="sendCompose">
              {{ sendingCompose ? 'Отправка…' : 'Отправить' }}
            </button>
          </div>
        </div>
      </template>

      <div v-else-if="!selectedThreadId" class="mail-page__placeholder mail-page__placeholder_center">
        Выберите переписку слева или нажмите «Написать»
      </div>

      <template v-else>
        <div class="mail-page__detail-header">
          <button class="mail-page__back-mobile" title="Назад" @click="backToList">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="mail-page__detail-meta">
            <h2 class="mail-page__detail-subject">{{ currentThread?.subject }}</h2>
            <span class="mail-page__detail-account">{{ accountLabel(currentThread?.account_id ?? 0) }}</span>
          </div>
          <div class="mail-page__detail-actions">
            <button
              v-if="currentFolder === 'spam'"
              class="mail-page__action-button"
              type="button"
              :disabled="movingThreads"
              aria-label="Отметить переписку как не спам"
              title="Не спам"
              @click="markCurrentThreadNotSpam"
            >
              <MailActionIcon name="not-spam" />
            </button>
            <template v-else-if="!isTrashFolder && spamSenderDomain">
              <button
                class="mail-page__action-button"
                type="button"
                :disabled="movingThreads"
                aria-label="Отправить письмо и будущие письма отправителя в спам"
                title="В спам"
                @click="askMarkCurrentThreadSpam(MailSpamRuleScope.SENDER)"
              >
                <MailActionIcon name="spam-sender" />
              </button>
              <button
                class="mail-page__action-button"
                type="button"
                :disabled="movingThreads"
                :aria-label="`Отправить в спам письма с домена ${spamSenderDomain}`"
                :title="`Спам-домен: ${spamSenderDomain}`"
                @click="askMarkCurrentThreadSpam(MailSpamRuleScope.DOMAIN)"
              >
                <MailActionIcon name="spam-domain" />
              </button>
            </template>
            <button
              v-if="currentThread && !isTrashFolder"
              class="mail-page__action-button"
              type="button"
              :disabled="movingThreads"
              aria-label="Переместить переписку"
              title="Переместить"
              @click="askMoveCurrentThread"
            >
              <MailActionIcon name="move" />
            </button>
            <button
              v-if="isTrashFolder"
              class="mail-page__action-button"
              type="button"
              aria-label="Восстановить переписку"
              title="Восстановить"
              @click="restoreThread"
            >
              <MailActionIcon name="restore" />
            </button>
            <button
              class="mail-page__action-button mail-page__action-button_danger"
              type="button"
              :aria-label="isTrashFolder ? 'Удалить переписку навсегда' : 'Удалить переписку'"
              :title="isTrashFolder ? 'Удалить навсегда' : 'Удалить'"
              @click="askDeleteThread"
            >
              <MailActionIcon name="delete" />
            </button>
          </div>
        </div>

        <div v-if="threadDraft" class="mail-page__draft-bar">
          <span>Это черновик. Получатель: {{ threadDraft.to_addresses.map((a) => a.address).join(', ') || '—' }}</span>
          <button class="mail-page__compose-btn" :disabled="!threadDraft.to_addresses.length" @click="sendThreadDraft">
            Отправить черновик
          </button>
        </div>

        <div class="mail-page__messages">
          <div v-if="pendingMessages" class="mail-page__placeholder">Загрузка…</div>
          <template v-for="(message, messageIndex) in orderedMessages" :key="message.id">
            <MailMessageView
              :message="message"
              :retrying="retryingMessageIds.has(message.id)"
              :links-disabled="currentFolder === 'spam'"
              @forward="forwardMessage"
              @delete="askDeleteMessage"
              @retry="retryMessage"
            />
            <template v-if="messageIndex === 0">
              <div v-if="!isTrashFolder && !replyOpen" class="mail-page__reply-trigger">
                <template v-if="hasReplyAllRecipients">
                  <button class="mail-page__compose-btn" type="button" @click="openReply(true)">Ответить всем</button>
                  <button class="mail-page__icon-btn" type="button" @click="openReply(false)">Ответить отправителю</button>
                </template>
                <button v-else class="mail-page__compose-btn" type="button" @click="openReply(false)">Ответить</button>
              </div>
              <div v-if="!isTrashFolder && replyOpen" class="mail-page__reply">
                <div class="mail-page__reply-recipients">
                  <label class="mail-page__reply-recipient">
                    <span class="mail-page__reply-recipient-label">Кому</span>
                    <input
                      v-model="replyTo"
                      class="mail-page__reply-recipient-input"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder="client@example.com"
                    />
                  </label>
                  <label class="mail-page__reply-recipient">
                    <span class="mail-page__reply-recipient-label">Копия</span>
                    <input
                      v-model="replyCc"
                      class="mail-page__reply-recipient-input"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder="Необязательно"
                    />
                  </label>
                </div>
                <textarea
                  ref="replyInput"
                  v-model="replyText"
                  class="mail-page__reply-input"
                  placeholder="Напишите ответ"
                  rows="4"
                  @keydown.ctrl.enter="sendReply"
                />
                <div v-if="replyAttachments.length" class="mail-page__reply-attachments">
                  <div
                    v-for="(attachment, index) in replyAttachments"
                    :key="attachment.s3_key"
                    class="mail-page__reply-attachment"
                  >
                    <img
                      v-if="attachment.previewUrl"
                      class="mail-page__reply-attachment-preview"
                      :src="attachment.previewUrl"
                      :alt="`Превью файла ${attachment.filename}`"
                    />
                    <div v-else class="mail-page__reply-attachment-file" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M7 3.75h6.6L18 8.15v12.1H7V3.75Z" />
                        <path d="M13.5 3.75v4.5H18" />
                      </svg>
                    </div>
                    <div class="mail-page__reply-attachment-meta">
                      <span class="mail-page__attach-name">{{ attachment.filename }}</span>
                      <span class="mail-page__attach-size">{{ formatAttachSize(attachment.size) }}</span>
                    </div>
                    <button
                      type="button"
                      class="mail-page__attach-remove mail-page__reply-attachment-remove"
                      :aria-label="`Убрать файл ${attachment.filename}`"
                      :disabled="sendingReply"
                      @click="removeReplyAttachment(index)"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div class="mail-page__reply-actions">
                  <input ref="replyAttachInput" type="file" multiple hidden @change="onReplyFilesPicked" />
                  <button
                    type="button"
                    class="mail-page__icon-btn mail-page__reply-attach-btn"
                    :disabled="uploadingReplyAttach || sendingReply"
                    @click="triggerReplyAttach"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="m8.5 12.5 5.8-5.8a3.1 3.1 0 0 1 4.4 4.4l-7.5 7.5a5 5 0 0 1-7.1-7.1l7.2-7.2" />
                    </svg>
                    {{ uploadingReplyAttach ? 'Загрузка…' : 'Прикрепить файл' }}
                  </button>
                  <div class="mail-page__reply-actions-main">
                    <button class="mail-page__icon-btn" :disabled="uploadingReplyAttach || sendingReply" @click="cancelReply">
                      Отмена
                    </button>
                    <button
                      class="mail-page__compose-btn"
                      :disabled="
                        sendingReply ||
                        uploadingReplyAttach ||
                        !splitAddresses(replyTo).length ||
                        (!replyText.trim() && !replyAttachments.length)
                      "
                      @click="sendReply"
                    >
                      {{ sendingReply ? 'Отправка…' : 'Отправить' }}
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>
      </template>
    </div>

    <BaseModal ref="moveModal" :dismissible="!movingThreads" @close="resetMoveDialog">
      <div class="mail-confirm" :aria-busy="movingThreads">
        <h2 class="mail-confirm__title">
          {{ moveThreadIds.length > 1 ? 'Переместить выбранные письма' : 'Переместить переписку' }}
        </h2>
        <p class="mail-confirm__text">
          {{ moveThreadIds.length > 1 ? `Выберите новую папку. Выбрано цепочек: ${moveThreadIds.length}.` : 'Выберите новую папку.' }}
        </p>
        <label class="mail-confirm__field">
          <span class="mail-confirm__label">Папка</span>
          <select v-model="moveTarget" class="mail-page__select" :disabled="movingThreads">
            <option value="" disabled>Выберите папку</option>
            <option :value="MailSystemFolder.INBOX">Входящие</option>
            <option :value="MailSystemFolder.SPAM">Спам</option>
            <option :value="MailSystemFolder.TRASH">Корзина</option>
            <option v-for="folder in folders" :key="folder.id" :value="`custom-${folder.id}`">{{ folder.name }}</option>
          </select>
        </label>
        <div v-if="movingThreads" class="mail-confirm__progress" role="status" aria-live="polite">
          <span class="mail-confirm__spinner" aria-hidden="true" />
          <span>Перемещаем письма…</span>
        </div>
        <div class="mail-confirm__actions">
          <button class="mail-page__icon-btn" type="button" :disabled="movingThreads" @click="moveModal?.close()">Отмена</button>
          <button
            class="mail-page__compose-btn mail-confirm__submit"
            type="button"
            :disabled="movingThreads || !moveTarget"
            @click="confirmMoveThreads"
          >
            <span v-if="movingThreads" class="mail-confirm__spinner mail-confirm__spinner_small" aria-hidden="true" />
            {{ movingThreads ? 'Перемещаем…' : 'Переместить' }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal ref="spamConfirmModal" :dismissible="!movingThreads" @close="resetSpamDialog">
      <div class="mail-confirm" :aria-busy="movingThreads">
        <h2 class="mail-confirm__title">
          {{ spamConfirmScope === MailSpamRuleScope.DOMAIN ? 'Заблокировать домен?' : 'Отправить в спам?' }}
        </h2>
        <p class="mail-confirm__text">
          <template v-if="spamConfirmScope === MailSpamRuleScope.DOMAIN">
            Письмо переедет в «Спам». Все следующие письма с домена
            <strong class="mail-confirm__emphasis">{{ spamSenderDomain }}</strong> тоже будут попадать туда.
          </template>
          <template v-else>
            Письмо переедет в «Спам». Следующие письма от
            <strong class="mail-confirm__emphasis">{{ spamSenderAddress }}</strong> тоже будут попадать туда.
          </template>
        </p>
        <div v-if="movingThreads" class="mail-confirm__progress" role="status" aria-live="polite">
          <span class="mail-confirm__spinner" aria-hidden="true" />
          <span>Добавляем правило спама…</span>
        </div>
        <div class="mail-confirm__actions">
          <button class="mail-page__icon-btn" type="button" :disabled="movingThreads" @click="spamConfirmModal?.close()">
            Отмена
          </button>
          <button
            class="mail-page__icon-btn mail-page__icon-btn_danger mail-confirm__submit"
            type="button"
            :disabled="movingThreads"
            @click="confirmCurrentThreadSpam"
          >
            <span v-if="movingThreads" class="mail-confirm__spinner mail-confirm__spinner_small" aria-hidden="true" />
            {{ movingThreads ? 'Перемещаем…' : spamConfirmScope === MailSpamRuleScope.DOMAIN ? 'Заблокировать домен' : 'В спам' }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal ref="confirmModal" :dismissible="!isDeleting">
      <div class="mail-confirm" :aria-busy="isDeleting">
        <h2 class="mail-confirm__title">
          {{
            deleteTarget?.kind === 'message'
              ? 'Удалить письмо?'
              : deleteTarget?.kind === 'threads'
                ? 'Удалить выбранные?'
                : 'Удалить переписку?'
          }}
        </h2>
        <p class="mail-confirm__text">
          <template v-if="deleteTarget?.kind === 'message'">
            Письмо «{{ deleteTarget?.label }}» будет удалено из переписки.
          </template>
          <template v-else-if="deleteTarget?.kind === 'threads' && deleteTarget.permanent">
            Выбранные цепочки ({{ deleteTarget.ids.length }}) будут удалены навсегда, без возможности восстановления.
          </template>
          <template v-else-if="deleteTarget?.kind === 'threads'">
            Выбранные цепочки ({{ deleteTarget.ids.length }}) переедут в Корзину.
          </template>
          <template v-else-if="deleteTarget?.permanent">
            Цепочка «{{ deleteTarget?.label }}» будет удалена навсегда, без возможности восстановления.
          </template>
          <template v-else> Цепочка «{{ deleteTarget?.label }}» переедет в Корзину. </template>
        </p>
        <div v-if="isDeleting" class="mail-confirm__progress" role="status" aria-live="polite">
          <span class="mail-confirm__spinner" aria-hidden="true" />
          <span>
            {{ deleteTarget?.kind === 'threads' ? `Удаляем выбранные письма: ${deleteTarget.ids.length}` : 'Удаляем письмо…' }}
          </span>
        </div>
        <div class="mail-confirm__actions">
          <button class="mail-page__icon-btn" :disabled="isDeleting" @click="confirmModal?.close()">Отмена</button>
          <button
            class="mail-page__icon-btn mail-page__icon-btn_danger mail-confirm__submit"
            :disabled="isDeleting"
            @click="confirmDelete"
          >
            <span v-if="isDeleting" class="mail-confirm__spinner mail-confirm__spinner_small" aria-hidden="true" />
            {{ isDeleting ? 'Удаляем…' : deleteTarget?.kind === 'message' || deleteTarget?.permanent ? 'Удалить' : 'В корзину' }}
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
.mail-page {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 190px 340px 1fr;
  overflow: hidden;

  @media (max-width: $screen-tablet) {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;

    &_detail-open {
      grid-template-rows: 1fr;

      .mail-page__folders,
      .mail-page__list {
        display: none;
      }
      .mail-page__detail {
        display: flex;
      }
    }
  }

  &__back-mobile {
    display: none;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    font-size: 26px;
    line-height: 1;

    @media (max-width: $screen-tablet) {
      @include flex(center);
    }
  }

  &__folders {
    @include flex(cn);
    gap: 12px;
    padding: 16px;
    height: 100%;
    overflow-y: auto;
    background-color: var(--dark-text-background-primary);
    border-right: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-tablet) {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      overflow-x: auto;
    }
  }

  &__folder-nav {
    @include flex(cn);
    gap: 2px;
    margin-top: 4px;

    @media (max-width: $screen-tablet) {
      flex-direction: row;
      flex-shrink: 0;
      margin-top: 0;
    }
  }

  &__folder {
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    text-align: left;
    cursor: pointer;
    @include flex(rn, j-start, a-center);
    gap: 8px;
    @extend %text-s-regular;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_active {
      background: var(--light-text-backgroung-primary-10);
      @extend %text-s-medium;
    }

    @media (max-width: $screen-tablet) {
      flex-shrink: 0;
      width: auto;
    }
  }

  &__folder-badge {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @include flex(center);
    @extend %p12-medium;

    @media (max-width: $screen-tablet) {
      margin-left: 0;
    }
  }

  &__custom-folders {
    @include flex(cn);
    gap: 2px;
    min-width: 0;

    @media (max-width: $screen-tablet) {
      flex-direction: row;
      align-items: center;
      flex-shrink: 0;
    }
  }

  &__custom-folders-heading {
    @include flex(rn, between, a-center);
    padding: 10px 8px 4px 12px;
    color: var(--light-text-backgroung-primary-50);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    @extend %p12-medium;

    @media (max-width: $screen-tablet) {
      padding: 0 4px 0 8px;
      white-space: nowrap;
    }
  }

  &__folder-add,
  &__folder-action,
  &__folder-save {
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__folder-add {
    width: 28px;
    height: 28px;
    font-size: 20px;
  }

  &__folder-form {
    @include flex(cn);
    gap: 6px;
    padding: 4px 0 8px;

    @media (max-width: $screen-tablet) {
      flex-direction: row;
      padding: 0;
    }
  }

  &__folder-input {
    min-width: 0;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 7px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %text-xs-regular;

    &:focus {
      border-color: var(--primary-50);
    }
  }

  &__folder-save {
    padding: 7px 10px;
    background: var(--primary-25);
    color: var(--light-text-backgroung-primary);
    @extend %p12-medium;
  }

  &__custom-folder-row {
    @include flex(rn, a-center);
    min-width: 0;

    &:hover .mail-page__folder-action,
    &:focus-within .mail-page__folder-action {
      opacity: 1;
    }
  }

  &__custom-folder-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__folder-action {
    width: 26px;
    height: 30px;
    flex: 0 0 26px;
    opacity: 0;

    @media (hover: none), (max-width: $screen-tablet) {
      opacity: 1;
    }
  }

  &__list {
    @include flex(cn);
    height: 100%;
    overflow: hidden;
    background-color: var(--dark-text-background-primary);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__title {
    margin: 0;
    @extend %display-xs-medium;

    @media (max-width: $screen-tablet) {
      display: none;
    }
  }

  &__compose-btn {
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-medium;

    &:hover:not(:disabled) {
      background: var(--primary-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &_block {
      width: 100%;

      @media (max-width: $screen-tablet) {
        display: none;
      }
    }
  }

  &__icon-btn {
    padding: 8px 14px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-regular;

    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-5);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &_danger {
      color: var(--danger-delete);
      border-color: var(--danger-delete-25);

      &:hover:not(:disabled) {
        background: var(--danger-delete-25);
      }
    }

    &_desktop {
      @media (max-width: $screen-tablet) {
        display: none;
      }
    }
  }

  &__filters {
    @include flex(cn);
    gap: 8px;
    padding: 16px 16px 12px;
  }

  &__compose-mobile {
    display: none;

    @media (max-width: $screen-tablet) {
      display: block;
      width: 100%;
    }
  }

  &__select,
  &__search {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %text-s-regular;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    &:focus {
      border-color: var(--primary-50);
    }

    @media (hover: none) and (pointer: coarse) {
      font-size: 16px;
    }
  }

  &__select option {
    background: var(--dark-text-background-primary);
  }

  &__move-select {
    min-height: 36px;
    max-width: 150px;
    padding: 7px 28px 7px 10px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %p12-regular;

    &:focus {
      border-color: var(--primary-50);
    }
  }

  &__combobox {
    position: relative;
    width: 100%;
  }

  &__combobox-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 10;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
    background: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--black-40);
  }

  &__combobox-option {
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-regular;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__threads {
    flex: 1;
    overflow-y: auto;
    @include flex(cn);

    @media (max-width: $screen-mobile-l) {
      padding-bottom: var(--mobile-nav-h);
    }
  }

  &__search_date {
    min-width: 0;
  }

  &__stats {
    flex: 1;
    overflow-y: auto;
    @include flex(cn);
    gap: 12px;
    padding: 16px;

    @media (max-width: $screen-mobile-l) {
      padding-bottom: calc(16px + var(--mobile-nav-h));
    }
  }

  &__stats-period {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  &__stats-card {
    @include flex(cn);
    gap: 4px;
    padding: 12px;
    border-radius: 10px;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__stats-value {
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @extend %text-l-medium;
  }

  &__stats-label {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__stats-note {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
    line-height: 1.45;
  }

  &__stats-heading {
    margin: 8px 0 0;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__stats-accounts {
    @include flex(cn);
    gap: 8px;
  }

  &__stats-account {
    @include flex(cn);
    gap: 2px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__stats-account-name {
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;
    @extend %text-s-medium;
  }

  &__stats-account-meta {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__stats-problem {
    @include flex(cn);
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 10px;
    background: transparent;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__stats-problem-top {
    @include flex(rn, between, a-center);
    gap: 8px;
    width: 100%;
  }

  &__stats-problem-subject {
    min-width: 0;
    color: var(--light-text-backgroung-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-medium;
  }

  &__stats-problem-meta {
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;
    @extend %text-xs-regular;
  }

  &__detail-empty {
    @include flex(cn, a-center, j-center);
    flex: 1;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    p {
      margin: 0;
      max-width: 36ch;
    }
  }

  &__detail-empty-hint {
    color: var(--light-text-backgroung-primary-25);
    @extend %text-xs-regular;
  }

  &__selection-bar {
    min-height: 60px;
    padding: 8px 12px 8px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    @include flex(rn, between, a-center);
    gap: 12px;
  }

  &__selection-count {
    min-width: 0;
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @extend %text-s-medium;

    strong {
      font-variant-numeric: tabular-nums;
    }
  }

  &__selection-actions {
    flex-shrink: 0;
    @include flex(rn, a-center);
    gap: 4px;
  }

  &__action-button {
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition:
      color 0.16s ease,
      border-color 0.16s ease,
      background-color 0.16s ease;
    @include flex(center);

    &:hover {
      border-color: var(--light-text-backgroung-primary-10);
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: 2px;
    }

    &:active {
      background: var(--light-text-backgroung-primary-10);
    }

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }

    &_danger {
      color: var(--danger-delete);

      &:hover {
        border-color: transparent;
        background: var(--danger-delete-25);
        color: var(--danger-delete);
      }

      &:active {
        background: var(--danger-delete-50);
      }
    }
  }

  &__load-more {
    flex-shrink: 0;
    padding: 16px;
    color: var(--light-text-backgroung-primary-50);
    text-align: center;
    @extend %p12-regular;
  }

  &__thread {
    @include flex(rn, a-center);
    gap: 12px;
    padding: 12px 16px;
    border: none;
    border-radius: 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    background: transparent;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_active {
      background: var(--light-text-backgroung-primary-10);
    }

    &_selected {
      background: var(--primary-10);
    }
  }

  &__thread-avatar {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    @include flex(center);
    color: var(--light-text-backgroung-primary);
    border: none;
    padding: 0;
    cursor: pointer;
    text-transform: uppercase;
    @extend %p12-bold;
  }

  &__thread-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &__thread-body {
    @include flex(cn);
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  &__thread-top,
  &__thread-bottom {
    @include flex(rn);
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__thread-counterparty {
    color: var(--light-text-backgroung-primary-50);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %p12-regular;
  }

  &__thread-date {
    color: var(--light-text-backgroung-primary-50);
    flex-shrink: 0;
    @extend %p12-regular;
  }

  &__thread-subject {
    color: var(--light-text-backgroung-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-regular;

    &_unread {
      @extend %text-s-medium;
    }
  }

  &__thread-badge {
    flex-shrink: 0;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    line-height: 20px;
    text-align: center;
    @extend %p12-medium;
  }

  &__thread-account {
    color: var(--primary-75);
    @extend %p12-regular;
  }

  &__detail {
    @include flex(cn);
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background-color: var(--light-text-backgroung-primary-5);

    @media (max-width: $screen-tablet) {
      display: none;
    }
  }

  &__detail-header {
    @include flex(rn, between, a-start);
    gap: 16px;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-tablet) {
      padding: 16px;
      flex-wrap: wrap;
      align-items: center;
    }
  }

  &__detail-meta {
    @include flex(cn);
    gap: 4px;
    min-width: 0;

    @media (max-width: $screen-tablet) {
      order: 3;
      flex-basis: 100%;
    }
  }

  &__detail-actions {
    @include flex(rn, a-center);
    gap: 4px;
    flex-shrink: 0;

    @media (max-width: $screen-tablet) {
      order: 4;
      flex-basis: 100%;
      flex-wrap: wrap;
      margin-left: 0;
    }
  }

  &__detail-subject {
    margin: 0;
    @extend %h1;

    @media (max-width: $screen-tablet) {
      flex: 1;
    }
  }

  &__detail-account {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__draft-bar {
    @include flex(rn, between, a-center);
    gap: 12px;
    padding: 10px 24px;
    background: var(--status-in-progress-15);
    color: var(--status-in-progress);
    @extend %text-s-regular;
  }

  &__messages {
    flex: 1;
    overflow-y: auto;
    @include flex(cn);
    gap: 12px;
    padding: 16px 24px;

    @media (max-width: $screen-tablet) {
      padding-left: 16px;
      padding-right: 16px;
    }
  }

  &__compose {
    flex: 1;
    overflow-y: auto;
    @include flex(cn);
    gap: 16px;
    padding: 16px 24px 24px;
  }

  &__compose-textarea {
    min-height: 240px;
    resize: vertical;
  }

  &__attach-list {
    @include flex(cn);
    gap: 6px;
  }

  &__attach-item {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    @extend %text-s-regular;
  }

  &__attach-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--light-text-backgroung-primary);
  }

  &__attach-size {
    flex-shrink: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-regular;
  }

  &__attach-remove {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;

    &:hover {
      color: var(--danger-delete);
    }
  }

  &__reply-trigger {
    @include flex(rn, a-center);
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 0 4px;

    .mail-page__compose-btn,
    .mail-page__icon-btn {
      min-height: 44px;
    }
  }

  &__reply-recipients {
    overflow: hidden;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);

    &:focus-within {
      border-color: var(--primary-50);
    }
  }

  &__reply-recipient {
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    @include flex(rn, a-center);
    gap: 12px;

    & + & {
      border-top: 1px solid var(--light-text-backgroung-primary-10);
    }
  }

  &__reply-recipient-label {
    flex: 0 0 54px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__reply-recipient-input {
    min-width: 0;
    flex: 1;
    padding: 10px 0;
    border: none;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %text-s-regular;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    @media (hover: none) and (pointer: coarse) {
      font-size: 16px;
    }
  }

  &__reply {
    @include flex(cn);
    gap: 8px;
    padding: 0 0 4px;
  }

  &__reply-actions {
    @include flex(rn, between, a-center);
    gap: 8px;

    @media (max-width: $screen-mobile-l) {
      align-items: stretch;
      flex-direction: column;
    }
  }

  &__reply-actions-main {
    @include flex(rn, j-end);
    gap: 8px;
  }

  &__reply-attach-btn {
    @include flex(rn, a-center);
    gap: 8px;

    svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }

  &__reply-attachments {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  &__reply-attachment {
    position: relative;
    min-width: 0;
    min-height: 64px;
    padding: 8px 40px 8px 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    @include flex(rn, a-center);
    gap: 10px;
  }

  &__reply-attachment-preview,
  &__reply-attachment-file {
    flex: 0 0 48px;
    width: 48px;
    height: 48px;
    border-radius: 6px;
  }

  &__reply-attachment-preview {
    display: block;
    object-fit: cover;
    background: var(--dark-text-background-primary);
  }

  &__reply-attachment-file {
    background: var(--primary-25);
    color: var(--primary-75);
    @include flex(center);

    svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }

  &__reply-attachment-meta {
    min-width: 0;
    @include flex(cn);
    gap: 2px;
  }

  &__reply-attachment-remove {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    border-radius: 6px;

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }
  }

  &__reply-input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    color: var(--light-text-backgroung-primary);
    font-family: inherit;
    resize: vertical;
    outline: none;
    @extend %text-s-regular;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    &:focus {
      border-color: var(--primary-50);
    }

    @media (hover: none) and (pointer: coarse) {
      font-size: 16px;
    }
  }

  &__placeholder {
    padding: 24px 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    &_error {
      @include flex(cn, a-start);
      gap: 12px;
      color: var(--light-text-backgroung-primary);
    }

    &_center {
      margin: auto;
      text-align: center;
    }
  }

  &__retry {
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--light-text-backgroung-primary-25);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-medium;

    &:hover {
      border-color: var(--primary-50);
      background: var(--primary-25);
    }

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: 2px;
    }
  }
}

.mail-composer {
  @include flex(cn);
  gap: 16px;
  width: 100%;
  padding: 0 24px;

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__label {
    @include flex(cn);
    gap: 6px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    &_grow {
      flex: 1;
    }
  }

  &__field {
    color: var(--light-text-backgroung-primary);
  }

  &__textarea {
    min-height: 160px;
    resize: vertical;
  }

  &__actions {
    @include flex(rn j-end);
    gap: 12px;
    flex-wrap: wrap;
  }
}

.mail-confirm {
  @include flex(cn);
  gap: 16px;
  width: 100%;
  padding: 0 24px;

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__text {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }

  &__field {
    min-width: 0;
    @include flex(cn);
    gap: 6px;
  }

  &__label {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__emphasis {
    color: var(--light-text-backgroung-primary);
  }

  &__actions {
    @include flex(rn, j-end);
    gap: 12px;
    flex-wrap: wrap;

    @media (max-width: $screen-mobile-l) {
      align-items: stretch;
      flex-direction: column-reverse;

      button {
        width: 100%;
        min-height: 44px;
        justify-content: center;
      }
    }
  }

  &__progress {
    @include flex(rn, a-center);
    gap: 10px;
    min-height: 24px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__submit {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__spinner {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    border: 2px solid var(--light-text-backgroung-primary-10);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: mail-confirm-spin 0.7s linear infinite;

    &_small {
      width: 14px;
      height: 14px;
    }
  }
}

@keyframes mail-confirm-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
