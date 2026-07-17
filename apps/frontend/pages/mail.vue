<script setup lang="ts">
import { storeToRefs } from 'pinia';
import BaseModal from '~/components/BaseModal.vue';
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
const selectedAccountId = ref(Number.isInteger(initialAccount) && initialAccount > 0 ? initialAccount : 0);
const search = ref('');
const initialThread = Number(route.query.thread);
const selectedThreadId = ref<number | null>(
  Number.isInteger(initialThread) && initialThread > 0 ? initialThread : null,
);
const replyText = ref('');
const sendingReply = ref(false);
const replyInput = ref<HTMLTextAreaElement | null>(null);
const replyOpen = ref(false);

const openReply = async () => {
  replyOpen.value = true;
  await nextTick();
  replyInput.value?.focus();
  replyInput.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const cancelReply = () => {
  replyOpen.value = false;
  replyText.value = '';
};

const FOLDERS = [
  { key: 'inbox', label: 'Входящие' },
  { key: 'sent', label: 'Отправленные' },
  { key: 'drafts', label: 'Черновики' },
  { key: 'trash', label: 'Корзина' },
] as const;
type FolderKey = (typeof FOLDERS)[number]['key'];
const initialFolder = FOLDERS.find((item) => item.key === route.query.folder)?.key ?? 'inbox';
const currentFolder = ref<FolderKey>(initialFolder);

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
const composeThreadId = ref<number | null>(
  composeParam !== '1' && Number(composeParam) > 0 ? Number(composeParam) : null,
);

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
  const html = composeForm.text
    ? `<div>${composeForm.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')}</div>`
    : undefined;
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
watch(
  () => [composeForm.to, composeForm.cc, composeForm.subject, composeForm.text, composeForm.attachments.length],
  () => {
    if (!composeMode.value) return;
    if (draftDebounce) clearTimeout(draftDebounce);
    draftDebounce = setTimeout(() => {
      void autosaveDraft().then(syncUrl);
    }, 1500);
  },
);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
const isLoadingMoreThreads = ref(false);
const selectedThreadIds = ref<Set<number>>(new Set());
const selectedThreadsCount = computed(() => selectedThreadIds.value.size);

const threadQuery = () => ({
  folder: currentFolder.value,
  account_id: selectedAccountId.value || undefined,
  search: search.value || undefined,
});

const loadThreads = async () => {
  selectedThreadIds.value = new Set();
  try {
    await mailStore.fetchThreads(threadQuery());
  } catch (e) {
    $toast.error(getErrorMessage(e));
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

const selectFolder = async (folder: FolderKey) => {
  if (currentFolder.value === folder) return;
  await autosaveDraft();
  composeMode.value = false;
  composeDraftId.value = null;
  composeThreadId.value = null;
  currentFolder.value = folder;
  selectedThreadId.value = null;
  void loadThreads();
};

const POLL_INTERVAL_MS = 30000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const pollThreads = () => {
  void mailStore
    .fetchThreads({
      ...threadQuery(),
      limit: Math.max(30, threads.value.length),
      silent: true,
    })
    .catch(() => {});
  void mailStore.fetchUnreadCount().catch(() => {});
};

const editDraft = (draft: MailMessage) => {
  composeDraftId.value = draft.id;
  composeThreadId.value = draft.thread_id;
  composeForm.account_id = currentThread.value?.account_id ?? composeForm.account_id;
  composeForm.to = draft.to_addresses.map((item) => item.address).join(', ');
  composeForm.cc = draft.cc_addresses.map((item) => item.address).join(', ');
  composeForm.subject = draft.subject ?? '';
  composeForm.text = draft.text_body ?? '';
  composeForm.attachments = (draft.attachments ?? []).map((item) => ({
    s3_key: item.s3_key,
    filename: item.filename,
    content_type: item.content_type,
    size: item.size,
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

const loadMailPageData = async () => {
  const tasks: Promise<unknown>[] = [
    mailStore.fetchAccounts(),
    loadThreads(),
    mailStore.fetchUnreadCount(),
    mailStore.fetchContacts(),
  ];
  if (selectedThreadId.value) {
    tasks.push(
      mailStore.fetchThread(selectedThreadId.value).catch(() => {
        selectedThreadId.value = null;
      }),
    );
  } else if (composeThreadId.value) {
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

onMounted(() => {
  if (!composeForm.account_id && accounts.value.length) {
    composeForm.account_id = accounts.value[0].id;
  }

  if (selectedThreadId.value) {
    const draft = messages.value.find((message) => message.status === 'draft');
    if (draft) {
      editDraft(draft);
    } else {
      void mailStore.markThreadRead(selectedThreadId.value).catch(() => {});
    }
  }


  pollTimer = setInterval(pollThreads, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  void autosaveDraft();
});

watch(selectedAccountId, loadThreads);
watch([currentFolder, selectedAccountId, selectedThreadId, composeMode, composeThreadId], syncUrl);

watch(search, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadThreads, 400);
});

const openThread = (thread: MailThread) => openThreadById(thread.id, Boolean(thread.unread_count));

const replyRecipient = computed(() => {
  const lastInbound = [...messages.value].reverse().find((message) => message.direction === MAIL_DIRECTIONS.inbound);
  return lastInbound?.from_address || currentThread.value?.counterparty_address || '';
});

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textToHtml = (value: string) => `<div>${escapeHtml(value).replace(/\n/g, '<br>')}</div>`;

const sendReply = async () => {
  if (!replyText.value.trim() || !currentThread.value || !replyRecipient.value) return;

  sendingReply.value = true;
  try {
    const subject = currentThread.value.subject.startsWith('Re:')
      ? currentThread.value.subject
      : `Re: ${currentThread.value.subject}`;

    await mailStore.sendMail({
      account_id: currentThread.value.account_id,
      to: [replyRecipient.value],
      subject,
      text: replyText.value,
      html: textToHtml(replyText.value),
      thread_id: currentThread.value.id,
    });
    replyText.value = '';
    replyOpen.value = false;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    sendingReply.value = false;
  }
};

watch(selectedThreadId, () => {
  replyOpen.value = false;
  replyText.value = '';
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
    await mailStore.deleteMessage(id);
    await loadThreads();
    syncUrl();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const forwardMessage = async (message: { from_address: string; subject: string | null; createdAt: string; text_body: string | null; html_body: string | null }) => {
  await autosaveDraft();
  composeDraftId.value = null;
  composeThreadId.value = null;
  composeForm.account_id = currentThread.value?.account_id || composeForm.account_id || (accounts.value[0]?.id ?? 0);
  composeForm.to = '';
  composeForm.cc = '';
  const subject = message.subject || '';
  composeForm.subject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
  const body = message.text_body || (message.html_body ? '(исходное письмо в HTML)' : '');
  composeForm.text = `\n\n---------- Пересланное письмо ----------\nОт: ${message.from_address}\nТема: ${subject}\n\n${body}`;
  composeForm.attachments = [];
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
    if (composeDraftId.value) {
      await mailStore.saveDraft({
        account_id: composeForm.account_id,
        to: recipients,
        cc: ccRecipients,
        subject: composeForm.subject.trim(),
        text: composeForm.text,
        html: textToHtml(composeForm.text),
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
        html: textToHtml(composeForm.text),
        attachments: composeForm.attachments.length ? composeForm.attachments : undefined,
      });
    }
    composeDraftId.value = null;
    composeThreadId.value = null;
    composeMode.value = false;
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
      html: composeForm.text ? textToHtml(composeForm.text) : undefined,
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

const confirmModal = ref<InstanceType<typeof BaseModal> | null>(null);
type DeleteTarget =
  | { kind: 'thread' | 'message'; permanent: boolean; id: number; label: string }
  | { kind: 'threads'; permanent: boolean; ids: number[] };
const deleteTarget = ref<DeleteTarget | null>(null);
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
  if (!deleteTarget.value) return;
  try {
    if (deleteTarget.value.kind === 'threads') {
      const selectedIds = deleteTarget.value.ids;
      if (deleteTarget.value.permanent) {
        await Promise.all(selectedIds.map((threadId) => mailStore.deleteThread(threadId)));
      } else {
        await Promise.all(selectedIds.map((threadId) => mailStore.moveThreadToFolder(threadId, 'trash')));
      }
      if (selectedThreadId.value && selectedIds.includes(selectedThreadId.value)) selectedThreadId.value = null;
      clearThreadSelection();
    } else if (deleteTarget.value.kind === 'message') {
      await mailStore.deleteMessage(deleteTarget.value.id);
    } else if (deleteTarget.value.permanent) {
      await mailStore.deleteThread(deleteTarget.value.id);
      selectedThreadId.value = null;
    } else {
      await mailStore.moveThreadToFolder(deleteTarget.value.id, 'trash');
      selectedThreadId.value = null;
    }
    confirmModal.value?.close();
    deleteTarget.value = null;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const restoreThread = async () => {
  if (!currentThread.value) return;
  try {
    await mailStore.moveThreadToFolder(currentThread.value.id, 'inbox');
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
      <button class="mail-page__compose-btn mail-page__compose-btn_block" @click="openComposer">Написать</button>
      <nav class="mail-page__folder-nav">
        <button
          v-for="folder in FOLDERS"
          :key="folder.key"
          :class="['mail-page__folder', { 'mail-page__folder_active': currentFolder === folder.key }]"
          @click="selectFolder(folder.key)"
        >
          {{ folder.label }}
        </button>
      </nav>
    </div>

    <div class="mail-page__list">
      <div class="mail-page__filters">
        <select v-model.number="selectedAccountId" class="mail-page__select">
          <option :value="0">Все ящики</option>
          <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.address }}</option>
        </select>
        <input v-model="search" class="mail-page__search" type="text" placeholder="Поиск по теме или адресу" />
        <button class="mail-page__compose-btn mail-page__compose-mobile" @click="openComposer">Написать</button>
      </div>

      <div v-if="selectedThreadsCount" class="mail-page__selection-bar">
        <span class="mail-page__selection-count">Выбрано: {{ selectedThreadsCount }}</span>
        <button class="mail-page__selection-clear" type="button" @click="clearThreadSelection">Снять</button>
        <button class="mail-page__selection-delete" type="button" @click="askDeleteSelectedThreads">
          {{ isTrashFolder ? 'Удалить навсегда' : 'Удалить выбранные' }}
        </button>
      </div>

      <div class="mail-page__threads" @scroll.passive="handleThreadsScroll">
        <div v-if="pendingThreads && !threads.length" class="mail-page__placeholder">Загрузка…</div>
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
            :style="avatarUrl(thread.counterparty_address) ? {} : { backgroundColor: avatarColor(thread.counterparty_address) }"
            :aria-label="selectedThreadIds.has(thread.id) ? 'Снять выбор' : 'Выбрать письмо'"
            :aria-pressed="selectedThreadIds.has(thread.id)"
            @click.stop="toggleThreadSelection(thread.id)"
          >
            <svg v-if="selectedThreadIds.has(thread.id)" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12.5l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <img
              v-else-if="avatarUrl(thread.counterparty_address)"
              :src="avatarUrl(thread.counterparty_address)"
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
              <span class="mail-page__thread-date">{{ threadDate(thread.last_message_at) }}</span>
            </span>
            <span class="mail-page__thread-bottom">
              <span :class="['mail-page__thread-subject', { 'mail-page__thread-subject_unread': thread.unread_count }]">
                {{ thread.subject }}
              </span>
              <span v-if="thread.unread_count" class="mail-page__thread-badge">{{ thread.unread_count }}</span>
            </span>
            <span v-if="!selectedAccountId" class="mail-page__thread-account">{{ accountLabel(thread.account_id) }}</span>
          </span>
        </div>
        <div v-if="isLoadingMoreThreads" class="mail-page__load-more">Загружаем ещё…</div>
      </div>
    </div>

    <div class="mail-page__detail">
      <template v-if="composeMode">
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
              <ul
                v-if="activeRecipientField === 'to' && recipientSuggestions.length"
                class="mail-page__combobox-list"
              >
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
              <ul
                v-if="activeRecipientField === 'cc' && recipientSuggestions.length"
                class="mail-page__combobox-list"
              >
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
            <button
              v-if="composeDraftId !== null"
              class="mail-page__icon-btn mail-page__icon-btn_danger"
              @click="deleteDraft"
            >
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
            <button v-if="isTrashFolder" class="mail-page__icon-btn" title="Восстановить" @click="restoreThread">
              Восстановить
            </button>
            <button class="mail-page__icon-btn mail-page__icon-btn_danger" title="Удалить" @click="askDeleteThread">
              {{ isTrashFolder ? 'Удалить навсегда' : 'Удалить' }}
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
          <MailMessageView
            v-for="message in messages"
            :key="message.id"
            :message="message"
            @forward="forwardMessage"
            @delete="askDeleteMessage"
          />
        </div>

        <div v-if="!isTrashFolder && !replyOpen" class="mail-page__reply-trigger">
          <button class="mail-page__compose-btn" @click="openReply">Ответить</button>
        </div>
        <div v-if="!isTrashFolder && replyOpen" class="mail-page__reply">
          <textarea
            ref="replyInput"
            v-model="replyText"
            class="mail-page__reply-input"
            :placeholder="`Ответить ${replyRecipient}`"
            rows="4"
            @keydown.ctrl.enter="sendReply"
          />
          <div class="mail-page__reply-actions">
            <button class="mail-page__icon-btn" @click="cancelReply">Отмена</button>
            <button class="mail-page__compose-btn" :disabled="sendingReply || !replyText.trim()" @click="sendReply">
              {{ sendingReply ? 'Отправка…' : 'Отправить' }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <BaseModal ref="confirmModal">
      <div class="mail-confirm">
        <h2 class="mail-confirm__title">
          {{ deleteTarget?.kind === 'message' ? 'Удалить письмо?' : deleteTarget?.kind === 'threads' ? 'Удалить выбранные?' : 'Удалить переписку?' }}
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
        <div class="mail-confirm__actions">
          <button class="mail-page__icon-btn" @click="confirmModal?.close()">Отмена</button>
          <button class="mail-page__icon-btn mail-page__icon-btn_danger" @click="confirmDelete">
            {{ deleteTarget?.kind === 'message' || deleteTarget?.permanent ? 'Удалить' : 'В корзину' }}
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
    display: block;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    text-align: left;
    cursor: pointer;
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

  &__selection-bar {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
  }

  &__selection-count {
    flex: 1;
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @extend %text-s-medium;
  }

  &__selection-clear,
  &__selection-delete {
    min-height: 36px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    @extend %p12-medium;

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: 2px;
    }
  }

  &__selection-clear {
    color: var(--light-text-backgroung-primary-50);

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__selection-delete {
    color: var(--danger-delete);

    &:hover {
      background: var(--danger-delete-25);
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
    @include flex(rn);
    gap: 8px;
    flex-shrink: 0;

    @media (max-width: $screen-tablet) {
      order: 2;
      margin-left: auto;
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
    padding: 12px 24px 20px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-tablet) {
      padding-left: 16px;
      padding-right: 16px;
    }
  }

  &__reply {
    @include flex(cn);
    gap: 8px;
    padding: 12px 24px 20px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);

    @media (max-width: $screen-tablet) {
      padding-left: 16px;
      padding-right: 16px;
    }
  }

  &__reply-actions {
    @include flex(rn, j-end);
    gap: 8px;
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

    &_center {
      margin: auto;
      text-align: center;
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
    @extend %text-s-regular;
  }

  &__actions {
    @include flex(rn, j-end);
    gap: 12px;
  }
}
</style>
