<script setup lang="ts">
import {
  CrmActivityKind,
  CrmQuickFilter,
  CrmStageKind,
  type CrmColumn,
  type CrmCompany,
  type CrmContact,
  type CrmDealDetail,
  type CrmDeal,
  type CrmOptions,
} from '@tracker/contracts';
import type { JSONContent } from '@tiptap/core';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import { CrmSection, CrmPanel, CrmProjectChoice } from '~/enums/crm.enums';
import type { Task } from '~/types/task';
import { ROLES, type User } from '~/types/user';
import type { SelectOption } from '~/types/select';
import type { FilterChip, FilterDefinition } from '~/types/filter';
import { FilterType } from '~/types/filter';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  ExternalLink,
  History,
  Mail,
  Minimize2,
  Phone,
  Plus,
  Send,
  Trash2,
  UserRound,
  X,
} from '@lucide/vue';
import IconSortAsc from '~/components/Icons/IconSortAsc.vue';
import IconSortDesc from '~/components/Icons/IconSortDesc.vue';
import { TYPE_SORT_LABELS, TypeSort } from '~/constants/sort.constants';
import { hasTiptapContent } from '~/utils/tiptap/content';
import { debounce } from '~/utils/debounce';
import { raisePageError } from '~/utils/error';
import { MAX_TASK_NAME_LENGTH } from '~/constants/task.constants';
import { format } from 'date-fns';

const props = defineProps<{ section: CrmSection }>();
useHead({ title: 'CRM' });
const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const userStore = useUserStore();
const baseURL = useApiBaseUrl();
const headers = useRequestHeaders(['cookie']);
const request = { baseURL, headers, credentials: 'include' as const };
if (!userStore.users.length) await userStore.fetchUsers();
const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const search = ref('');
const companyFilter = ref('');
const ownerFilter = ref('');
const sourceFilter = ref('');
const quick = ref(CrmQuickFilter.ALL);
const collapsed = ref<number[]>([]);
const dragging = ref<number | null>(null);
const {
  isDragging: isBoardDragging,
  onPointerDown: onBoardPointerDown,
  onPointerMove: onBoardPointerMove,
  onPointerEnd: onBoardPointerEnd,
} = useHorizontalDragScroll();
const today = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const query = computed(() => ({
  search: search.value || undefined,
  company_id: companyFilter.value || undefined,
  responsible_id: ownerFilter.value || undefined,
  source: sourceFilter.value || undefined,
  quick: quick.value,
  today: today(),
}));
const {
  data: options,
  error: optionsError,
  refresh: refreshOptions,
} = await useAsyncData('crm-options', () => $fetch<CrmOptions>('/api/crm/options', request));
collapsed.value = [...(options.value?.collapsed_stage_ids ?? [])];
const {
  data: board,
  error: boardError,
  pending,
  refresh: refreshBoard,
} = await useAsyncData(`crm-board-${props.section}`, () =>
  props.section === CrmSection.DEALS
    ? $fetch<CrmColumn[]>('/api/crm/board', { ...request, query: query.value })
    : Promise.resolve([]),
);
const crmLoadError = computed(() => optionsError.value ?? boardError.value);
const showCrmLoadError = (cause: unknown) => {
  if (cause) raisePageError(500, 'Не удалось загрузить CRM');
};
showCrmLoadError(crmLoadError.value);
watch(crmLoadError, showCrmLoadError);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void refreshBoard(), 250);
});
onBeforeUnmount(() => clearTimeout(debounceTimer));
const error = ref('');
const busy = ref(false);
const money = (amount: string | number | null) =>
  amount === null
    ? 'Не указана'
    : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(amount));
const stageColor = (stage: CrmColumn['stage']) => {
  if (stage.kind === CrmStageKind.WON) return 'var(--crm-stage-won)';
  if (stage.kind === CrmStageKind.LOST) return 'var(--crm-stage-lost)';

  return (
    {
      1: 'var(--crm-stage-unprocessed)',
      2: 'var(--crm-stage-qualification)',
      3: 'var(--crm-stage-discussion)',
      4: 'var(--crm-stage-proposal)',
      5: 'var(--crm-stage-negotiation)',
      6: 'var(--crm-stage-contract)',
    }[stage.position] ?? 'var(--crm-stage-unprocessed)'
  );
};
const setStageCollapsed = async (stageId: number, value: boolean) => {
  const previous = [...collapsed.value];
  collapsed.value = value ? [...new Set([...collapsed.value, stageId])] : collapsed.value.filter((id) => id !== stageId);
  try {
    await $fetch('/api/crm/preferences/collapsed-stages', {
      ...request,
      method: 'PATCH',
      body: { collapsed_stage_ids: collapsed.value },
    });
  } catch (cause) {
    collapsed.value = previous;
    error.value = getErrorMessage(cause);
  }
};
const companyName = (id: number | null) => options.value?.companies.find((c) => c.id === id)?.name ?? 'Без компании';
const ownerName = (id: number | null) => options.value?.users.find((u) => u.id === id)?.name ?? 'Не назначен';
const contactFullName = (contact: Pick<CrmContact, 'name' | 'last_name' | 'patronymic'>) =>
  [contact.name, contact.last_name, contact.patronymic]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
const stats = (id: number) => options.value?.company_stats[id] ?? { count: 0, amount: '0' };
const companies = computed(() =>
  (options.value?.companies ?? []).filter((c) => c.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())),
);
const contacts = computed(() =>
  (options.value?.contacts ?? []).filter(
    (c) =>
      contactFullName(c).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()) &&
      (!companyFilter.value || c.company_id === Number(companyFilter.value)),
  ),
);
type DirectorySortDirection = 'asc' | 'desc';
type CompanySortKey = 'name' | 'website' | 'responsible' | 'deals' | 'amount';
type ContactSortKey = 'name' | 'company' | 'position' | 'communication';

const companyColumns: ReadonlyArray<{ key: CompanySortKey; label: string }> = [
  { key: 'name', label: 'Компания' },
  { key: 'website', label: 'Сайт' },
  { key: 'responsible', label: 'Ответственный' },
  { key: 'deals', label: 'Открытые сделки' },
  { key: 'amount', label: 'Сумма в работе' },
];
const contactColumns: ReadonlyArray<{ key: ContactSortKey; label: string }> = [
  { key: 'name', label: 'Контакт' },
  { key: 'company', label: 'Компания' },
  { key: 'position', label: 'Должность' },
  { key: 'communication', label: 'Телефон / Email' },
];
const companySortKey = ref<CompanySortKey>('name');
const companySortDirection = ref<DirectorySortDirection>('asc');
const contactSortKey = ref<ContactSortKey>('name');
const contactSortDirection = ref<DirectorySortDirection>('asc');
const directoryCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

const compareDirectoryValues = (left: string | number, right: string | number) => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return directoryCollator.compare(String(left), String(right));
};
const getCompanySortValue = (company: CrmCompany, key: CompanySortKey): string | number => {
  if (key === 'responsible') return ownerName(company.responsible_id);
  if (key === 'deals') return stats(company.id).count;
  if (key === 'amount') return Number(stats(company.id).amount);
  return company[key];
};
const getContactSortValue = (contact: CrmContact, key: ContactSortKey): string => {
  if (key === 'name') return contactFullName(contact);
  if (key === 'company') return companyName(contact.company_id);
  if (key === 'communication') return `${contact.phone} ${contact.email}`.trim();
  return contact.position;
};
const sortedCompanies = computed(() =>
  companies.value
    .map((company, originalIndex) => ({ company, originalIndex }))
    .sort((left, right) => {
      const comparison = compareDirectoryValues(
        getCompanySortValue(left.company, companySortKey.value),
        getCompanySortValue(right.company, companySortKey.value),
      );
      if (comparison === 0) return left.originalIndex - right.originalIndex;
      return companySortDirection.value === 'asc' ? comparison : -comparison;
    })
    .map(({ company }) => company),
);
const sortedContacts = computed(() =>
  contacts.value
    .map((contact, originalIndex) => ({ contact, originalIndex }))
    .sort((left, right) => {
      const comparison = compareDirectoryValues(
        getContactSortValue(left.contact, contactSortKey.value),
        getContactSortValue(right.contact, contactSortKey.value),
      );
      if (comparison === 0) return left.originalIndex - right.originalIndex;
      return contactSortDirection.value === 'asc' ? comparison : -comparison;
    })
    .map(({ contact }) => contact),
);
const toggleCompanySort = (key: CompanySortKey) => {
  if (companySortKey.value === key) {
    companySortDirection.value = companySortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }
  companySortKey.value = key;
  companySortDirection.value = 'asc';
};
const toggleContactSort = (key: ContactSortKey) => {
  if (contactSortKey.value === key) {
    contactSortDirection.value = contactSortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }
  contactSortKey.value = key;
  contactSortDirection.value = 'asc';
};
const getDirectoryAriaSort = <T extends string>(
  key: T,
  activeKey: T,
  direction: DirectorySortDirection,
): 'ascending' | 'descending' | 'none' => {
  if (key !== activeKey) return 'none';
  return direction === 'asc' ? 'ascending' : 'descending';
};
const getDirectorySortLabel = <T extends string>(
  key: T,
  label: string,
  activeKey: T,
  direction: DirectorySortDirection,
) => {
  const nextDirection = key === activeKey && direction === 'asc' ? 'desc' : 'asc';
  return `Сортировать столбец «${label}» по ${nextDirection === 'asc' ? 'возрастанию' : 'убыванию'}`;
};
const companyContacts = computed(() =>
  companyForm.value.id ? (options.value?.contacts ?? []).filter((contact) => contact.company_id === companyForm.value.id) : [],
);
const panelId = computed(() => Number(route.query.deal || 0));
const {
  data: deal,
  error: dealError,
  pending: dealPending,
  refresh: refreshDeal,
} = await useAsyncData(
  'crm-deal',
  () => (panelId.value ? $fetch<CrmDealDetail>(`/api/crm/deals/${panelId.value}`, request) : Promise.resolve(null)),
  { watch: [panelId] },
);
const isCurrentDeal = computed(() => deal.value?.id === panelId.value);
const isDealInitialLoading = computed(() => dealPending.value && !isCurrentDeal.value);
const panel = ref<CrmPanel | null>(panelId.value ? CrmPanel.DEAL : null);
watch(panelId, (id) => {
  if (id) panel.value = CrmPanel.DEAL;
  else if (panel.value === CrmPanel.DEAL) panel.value = null;
});
const panelElement = ref<HTMLElement>();
let panelTrigger: HTMLElement | null = null;
watch(panel, async (value, previous) => {
  if (!import.meta.client) return;
  if (value && !previous) panelTrigger = document.activeElement as HTMLElement | null;
  await nextTick();
  if (value) panelElement.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  else panelTrigger?.focus({ preventScroll: true });
});
const directoryPanel = ref<CrmPanel.COMPANY | CrmPanel.CONTACT | null>(null);
const directoryElement = ref<HTMLElement>();
let directoryTrigger: HTMLElement | null = null;
watch(directoryPanel, async (value, previous) => {
  if (!import.meta.client) return;
  if (value && !previous) directoryTrigger = document.activeElement as HTMLElement | null;
  await nextTick();
  if (value) directoryElement.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  else directoryTrigger?.focus({ preventScroll: true });
});
const expanded = ref(false);
const isDeleteDealConfirmOpen = ref(false);
const isDeleteDirectoryConfirmOpen = ref(false);
const returnToDeal = ref(false);
const savedScroll = ref(0);
const companyForm = ref<CrmCompany>({ id: 0, name: '', legal_name: '', inn: '', website: '', notes: '', responsible_id: null });
const contactForm = ref<CrmContact>({
  id: 0,
  name: '',
  last_name: '',
  patronymic: '',
  company_id: null,
  position: '',
  phone: '',
  email: '',
  telegram: '',
});
const isCompanyFormValid = computed(() => companyForm.value.name.trim().length > 0);
const isContactFormValid = computed(() => contactForm.value.name.trim().length > 0);
const draft = reactive({
  title: '',
  stage_id: 1,
  amount: null as number | null,
  company_id: null as number | null,
  contact_ids: [] as number[],
  primary_contact_id: null as number | null,
  responsible_id: null as number | null,
  source: '',
  expected_close: '',
  project_id: null as number | null,
});
let syncedDealId = 0;
let savedFields = '';
const commentDrafts = useState<Record<number, JSONContent>>('crm-comment-drafts', () => ({}));
const commentEditor = ref<InstanceType<typeof EditorTiptap>>();
const comment = computed({
  get: () => commentDrafts.value[panelId.value] ?? emptyDoc(),
  set: (value) => {
    commentDrafts.value[panelId.value] = value;
  },
});
const timelineSort = useCookie<TypeSort>('crm-timeline-sort', {
  default: () => TypeSort.ASC,
  maxAge: 365 * 24 * 60 * 60,
  path: '/',
});
const timeline = computed(() =>
  [...(deal.value?.activities ?? [])].sort((a, b) => {
    const comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id;
    return timelineSort.value === TypeSort.DESC ? -comparison : comparison;
  }),
);
const toggleTimelineSort = () => {
  timelineSort.value = timelineSort.value === TypeSort.ASC ? TypeSort.DESC : TypeSort.ASC;
};
const formatCommentDate = (date: string) => format(new Date(date), 'dd.MM.yy ⋅ HH:mm');
const formatActivityDate = (date: string) =>
  new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const authorInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
const tomorrowDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Intl.DateTimeFormat('sv-SE').format(date);
};
const taskTitle = ref('');
const taskDate = ref(tomorrowDate());
const taskOwner = ref<number | null>(userStore.user?.id ?? null);
const isTaskFormOpen = ref(false);
const taskTitleInput = ref<HTMLInputElement>();
const openTaskForm = async () => {
  taskTitle.value = '';
  taskDate.value = tomorrowDate();
  taskOwner.value = userStore.user?.id ?? null;
  isTaskFormOpen.value = true;
  await nextTick();
  taskTitleInput.value?.focus();
};
const closeTaskForm = () => {
  isTaskFormOpen.value = false;
};
const taskSearch = ref('');
const taskResults = ref<Task[]>([]);
const taskSearchPending = ref(false);
const isTaskLinkOpen = ref(false);
const taskLinkInput = ref<HTMLInputElement>();
const showCompleted = ref(false);
const tasks = computed(() => deal.value?.tasks.filter((t) => showCompleted.value || t.status !== 'closed') ?? []);
const newTitle = ref('');
const newDealCompanyId = ref<number | null>(null);
const newDealContactId = ref<number | null>(null);
const newDealDialog = ref<HTMLDialogElement>();
const stageDialog = ref<HTMLDialogElement>();
const stageChange = ref<{ id: number; stage: number; kind: CrmStageKind } | null>(null);
const reason = ref('');
const projectChoice = ref(CrmProjectChoice.NONE);
const selectedProject = ref<number | null>(null);
const relatedDeals = ref<CrmDeal[]>([]);
const companyOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'Все компании' },
  ...(options.value?.companies.map((company) => ({ value: company.id, label: company.name })) ?? []),
]);
const ownerOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'Все ответственные' },
  ...(options.value?.users.map((user) => ({ value: user.id, label: user.name })) ?? []),
]);
const sourceOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'Все источники' },
  ...(options.value?.sources.map((source) => ({ value: source, label: source })) ?? []),
]);
const optionalCompanyOptions = computed<SelectOption[]>(() => [
  { value: null, label: 'Без компании' },
  ...companyOptions.value.slice(1),
]);
const optionalSourceOptions = computed<SelectOption[]>(() => [
  { value: null, label: 'Источник не определён' },
  ...sourceOptions.value.slice(1),
]);
const crmFilterPanel = ref<{ clearSearch: () => void } | null>(null);
const quickFilterOptions: SelectOption[] = [
  { value: CrmQuickFilter.OVERDUE, label: 'Просроченные действия' },
  { value: CrmQuickFilter.UNSCHEDULED, label: 'Без следующего шага' },
];
const isMineFilterActive = computed(() => quick.value === CrmQuickFilter.MINE);
const toggleMineFilter = () => {
  quick.value = isMineFilterActive.value ? CrmQuickFilter.ALL : CrmQuickFilter.MINE;
};
const crmFilterDefinitions = computed<FilterDefinition[]>(() => {
  if (props.section === CrmSection.COMPANIES) return [];

  const definitions: FilterDefinition[] = [
    { type: FilterType.COMPANY, label: 'Компания', options: companyOptions.value.slice(1) },
  ];
  if (props.section === CrmSection.DEALS) {
    definitions.push(
      { type: FilterType.RESPONSIBLE, label: 'Ответственный', options: ownerOptions.value.slice(1) },
      { type: FilterType.SOURCE, label: 'Источник', options: sourceOptions.value.slice(1) },
      { type: FilterType.DEAL_QUICK, label: 'Быстрый фильтр', options: quickFilterOptions },
    );
  }
  return definitions;
});
const crmFilterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = [];
  if (companyFilter.value) {
    chips.push({
      id: FilterType.COMPANY,
      type: FilterType.COMPANY,
      label: options.value?.companies.find((company) => company.id === Number(companyFilter.value))?.name ?? 'Компания',
      value: Number(companyFilter.value),
      isNegative: false,
      canNegate: false,
    });
  }
  if (ownerFilter.value) {
    chips.push({
      id: FilterType.RESPONSIBLE,
      type: FilterType.RESPONSIBLE,
      label: options.value?.users.find((user) => user.id === Number(ownerFilter.value))?.name ?? 'Ответственный',
      value: Number(ownerFilter.value),
      isNegative: false,
      canNegate: false,
    });
  }
  if (sourceFilter.value) {
    chips.push({
      id: FilterType.SOURCE,
      type: FilterType.SOURCE,
      label: sourceFilter.value,
      value: sourceFilter.value,
      isNegative: false,
      canNegate: false,
    });
  }
  if (quick.value !== CrmQuickFilter.ALL && quick.value !== CrmQuickFilter.MINE) {
    chips.push({
      id: FilterType.DEAL_QUICK,
      type: FilterType.DEAL_QUICK,
      label: String(quickFilterOptions.find((option) => option.value === quick.value)?.label ?? 'Быстрый фильтр'),
      value: quick.value,
      isNegative: false,
      canNegate: false,
    });
  }
  if (search.value) {
    chips.push({
      id: FilterType.SEARCH,
      type: FilterType.SEARCH,
      label: `Поиск: "${search.value}"`,
      value: search.value,
      isNegative: false,
      canNegate: false,
    });
  }
  return chips;
});
const handleCrmSearch = (event: Event) => {
  search.value = (event.target as HTMLInputElement).value.trim();
};
const addCrmFilter = (filter: { type: FilterType; value: string | number }) => {
  if (filter.type === FilterType.COMPANY) companyFilter.value = String(filter.value);
  if (filter.type === FilterType.RESPONSIBLE) ownerFilter.value = String(filter.value);
  if (filter.type === FilterType.SOURCE) sourceFilter.value = String(filter.value);
  if (filter.type === FilterType.DEAL_QUICK) quick.value = filter.value as CrmQuickFilter;
};
const removeCrmFilter = (chipId: string) => {
  if (chipId === FilterType.COMPANY) companyFilter.value = '';
  if (chipId === FilterType.RESPONSIBLE) ownerFilter.value = '';
  if (chipId === FilterType.SOURCE) sourceFilter.value = '';
  if (chipId === FilterType.DEAL_QUICK) quick.value = CrmQuickFilter.ALL;
  if (chipId === FilterType.SEARCH) {
    search.value = '';
    crmFilterPanel.value?.clearSearch();
  }
};
const stageOptions = computed<SelectOption[]>(
  () => options.value?.stages.map((stage) => ({ value: stage.id, label: stage.name })) ?? [],
);
const projectOptions = computed<SelectOption[]>(
  () => options.value?.projects.map((project) => ({ value: project.id, label: project.name })) ?? [],
);
const dealProjectOptions = computed<SelectOption[]>(() => [{ value: 0, label: 'Без проекта' }, ...projectOptions.value]);
const responsibleOptions = computed<SelectOption[]>(
  () => options.value?.users.map((user) => ({ value: user.id, label: user.name })) ?? [],
);
const optionalResponsibleOptions = computed<SelectOption[]>(() => [
  { value: null, label: 'Не назначен' },
  ...responsibleOptions.value,
]);
const crmMentionUsers = computed<User[]>(() =>
  userStore.users.filter((user) => user.role === ROLES.admin && user.id !== userStore.user?.id),
);
const dealResponsibleOptions = computed<SelectOption[]>(() => [{ value: 0, label: 'Не назначен' }, ...responsibleOptions.value]);
const contactOptions = computed<SelectOption[]>(
  () =>
    options.value?.contacts.map((contact) => {
      const company = options.value?.companies.find((item) => item.id === contact.company_id);
      const name = contactFullName(contact);
      return { value: contact.id, label: company ? `${name} · ${company.name}` : name };
    }) ?? [],
);
const optionalContactOptions = computed<SelectOption[]>(() => [
  { value: null, label: 'Контактное лицо не выбрано' },
  ...contactOptions.value,
]);
const dealContactOptions = computed<SelectOption[]>(() => [
  { value: null, label: 'Контактное лицо не выбрано' },
  ...(options.value?.contacts.map((contact) => ({ value: contact.id, label: contactFullName(contact) })) ?? []),
]);
const selectedContactId = computed<number | null>({
  get: () => draft.primary_contact_id ?? draft.contact_ids[0] ?? null,
  set: (value) => {
    const id = Number(value) || null;
    draft.contact_ids = id ? [id] : [];
    draft.primary_contact_id = id;
  },
});
const selectedContact = computed(() => options.value?.contacts.find((contact) => contact.id === selectedContactId.value));
const selectedContactTelegramHref = computed(() => {
  const telegram = selectedContact.value?.telegram?.trim();
  if (!telegram) return '';
  if (/^https?:\/\//i.test(telegram)) return telegram;
  return `https://t.me/${telegram.replace(/^@/, '')}`;
});
const hasSelectedContactChannels = computed(() =>
  Boolean(selectedContact.value?.phone || selectedContact.value?.email || selectedContact.value?.telegram),
);
const directoryTitle = computed(() => {
  if (directoryPanel.value === CrmPanel.COMPANY) return companyForm.value.id ? 'Компания' : 'Новая компания';
  return contactForm.value.id ? 'Контакт' : 'Новый контакт';
});
const directoryEntityId = computed(() =>
  directoryPanel.value === CrmPanel.COMPANY ? companyForm.value.id : contactForm.value.id,
);
const directoryEntityName = computed(() =>
  directoryPanel.value === CrmPanel.COMPANY ? companyForm.value.name : contactFullName(contactForm.value),
);
const openDeleteDirectoryConfirm = () => {
  error.value = '';
  isDeleteDirectoryConfirmOpen.value = true;
};
const copyLink = () =>
  run(async () => {
    await navigator.clipboard.writeText(window.location.href);
  });

const openNewDealDialog = () => {
  error.value = '';
  newTitle.value = '';
  newDealCompanyId.value = null;
  newDealContactId.value = null;
  newDealDialog.value?.showModal();
};

const selectNewDealCompany = (value: string | number | (string | number)[] | null) => {
  const companyId = Number(value) || null;
  newDealCompanyId.value = companyId;
  const contact = options.value?.contacts.find((item) => item.id === newDealContactId.value);
  if (contact?.company_id && contact.company_id !== companyId) newDealContactId.value = null;
};

const selectNewDealContact = (value: string | number | (string | number)[] | null) => {
  const contactId = Number(value) || null;
  newDealContactId.value = contactId;
  const contact = options.value?.contacts.find((item) => item.id === contactId);
  if (contact?.company_id) newDealCompanyId.value = contact.company_id;
};

const run = async (action: () => Promise<void>) => {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = getErrorMessage(e);
  } finally {
    busy.value = false;
  }
};
const refreshAll = async () => {
  await Promise.all([refreshBoard(), refreshOptions(), panelId.value ? refreshDeal() : Promise.resolve()]);
};
const openDeal = async (id: number) => {
  directoryPanel.value = null;
  returnToDeal.value = false;
  isTaskFormOpen.value = false;
  panel.value = CrmPanel.DEAL;
  await router.push({ query: { ...route.query, deal: id } });
};
const closePanel = async () => {
  directoryPanel.value = null;
  returnToDeal.value = false;
  panel.value = null;
  const { deal: _deal, ...rest } = route.query;
  await router.replace({ query: rest });
};
const deleteDeal = async () => {
  const id = panelId.value;
  if (!id) return;
  await run(async () => {
    await $fetch(`/api/crm/deals/${id}`, { ...request, method: 'DELETE' });
    isDeleteDealConfirmOpen.value = false;
    Reflect.deleteProperty(commentDrafts.value, id);
    await closePanel();
    await Promise.all([refreshBoard(), refreshOptions()]);
  });
};
const closeDirectory = async () => {
  const shouldRestoreDeal = returnToDeal.value;
  directoryPanel.value = null;
  returnToDeal.value = false;
  await nextTick();
  if (shouldRestoreDeal && panelElement.value) panelElement.value.scrollTop = savedScroll.value;
};
const openDirectory = async (kind: CrmPanel.COMPANY | CrmPanel.CONTACT, id = 0, fromDeal = false) => {
  error.value = '';
  returnToDeal.value = fromDeal;
  if (panel.value === CrmPanel.DEAL) savedScroll.value = panelElement.value?.scrollTop ?? 0;
  if (kind === CrmPanel.COMPANY)
    companyForm.value = {
      id: 0,
      name: '',
      legal_name: '',
      inn: '',
      website: '',
      notes: '',
      responsible_id: null,
      ...options.value?.companies.find((c) => c.id === id),
    };
  else
    contactForm.value = {
      id: 0,
      name: '',
      last_name: '',
      patronymic: '',
      company_id: fromDeal ? draft.company_id : null,
      position: '',
      phone: '',
      email: '',
      telegram: '',
      ...options.value?.contacts.find((c) => c.id === id),
    };
  directoryPanel.value = kind;
  relatedDeals.value = [];
  if (id)
    await run(async () => {
      const columns = await $fetch<CrmColumn[]>('/api/crm/board', {
        ...request,
        query: kind === CrmPanel.COMPANY ? { company_id: id, limit: 100 } : { contact_id: id, limit: 100 },
      });
      relatedDeals.value = columns.flatMap((c) => c.cards);
    });
};
const saveDirectory = async () => {
  const kind = directoryPanel.value;
  if (!kind) return;
  await run(async () => {
    const form = kind === CrmPanel.COMPANY ? companyForm.value : contactForm.value;
    const { id, ...fields } = form;
    const body = { ...fields, name: fields.name.trim() };
    const path = kind === CrmPanel.COMPANY ? CrmSection.COMPANIES : CrmSection.CONTACTS;
    const result = await $fetch<CrmCompany | CrmContact>(`/api/crm/${path}${id ? `/${id}` : ''}`, {
      ...request,
      method: id ? 'PATCH' : 'POST',
      body,
    });
    await refreshOptions();
    if (returnToDeal.value && !id) {
      if (kind === CrmPanel.COMPANY) {
        draft.company_id = result.id;
        await persistDeal({ company_id: result.id });
      } else {
        draft.contact_ids = [result.id];
        draft.primary_contact_id = result.id;
        await persistDeal({ contact_ids: [result.id], primary_contact_id: result.id });
      }
    }
    if (kind === CrmPanel.COMPANY) companyForm.value = result as CrmCompany;
    else contactForm.value = result as CrmContact;
    if (returnToDeal.value) await closeDirectory();
  });
};
const deleteDirectory = async () => {
  const kind = directoryPanel.value;
  const id = directoryEntityId.value;
  if (!kind || !id) return;
  await run(async () => {
    const path = kind === CrmPanel.COMPANY ? CrmSection.COMPANIES : CrmSection.CONTACTS;
    await $fetch(`/api/crm/${path}/${id}`, { ...request, method: 'DELETE' });
    isDeleteDirectoryConfirmOpen.value = false;
    await Promise.all([refreshOptions(), refreshBoard(), panelId.value ? refreshDeal() : Promise.resolve()]);
    await closeDirectory();
  });
};
const createDeal = async () => {
  await run(async () => {
    const created = await $fetch<CrmDealDetail>('/api/crm/deals', {
      ...request,
      method: 'POST',
      body: {
        title: newTitle.value.trim(),
        company_id: newDealCompanyId.value,
        contact_ids: newDealContactId.value ? [newDealContactId.value] : [],
        primary_contact_id: newDealContactId.value,
      },
    });
    newTitle.value = '';
    newDealCompanyId.value = null;
    newDealContactId.value = null;
    newDealDialog.value?.close();
    await refreshBoard();
    await openDeal(created.id);
  });
};
const dealBody = () => {
  return {
    title: draft.title,
    amount: draft.amount === null || String(draft.amount) === '' ? null : Number(draft.amount),
    company_id: draft.company_id,
    contact_ids: draft.contact_ids,
    primary_contact_id: draft.contact_ids.includes(draft.primary_contact_id ?? 0) ? draft.primary_contact_id : null,
    responsible_id: draft.responsible_id,
    source: draft.source,
    expected_close: draft.expected_close || null,
    project_id: draft.project_id,
  };
};
const persistDeal = async (body: Record<string, unknown> = dealBody()) => {
  await $fetch(`/api/crm/deals/${panelId.value}`, { ...request, method: 'PATCH', body });
  savedFields = JSON.stringify(dealBody());
  await refreshAll();
};
const saveDeal = async (body: Record<string, unknown> = dealBody()) => {
  await run(() => persistDeal(body));
};
const updateDealAmount = async (event: Event) => {
  const value = (event.target as HTMLInputElement).value;
  draft.amount = value === '' ? null : Number(value);
  await saveDeal({ amount: draft.amount });
};
const updateDealResponsible = async (value: string | number | (string | number)[] | null) => {
  draft.responsible_id = Number(value) || null;
  await saveDeal({ responsible_id: draft.responsible_id });
};
const updateDealCompany = async (value: string | number | (string | number)[] | null) => {
  draft.company_id = Number(value) || null;
  await saveDeal({ company_id: draft.company_id });
};
const updateDealContact = async (value: string | number | (string | number)[] | null) => {
  selectedContactId.value = Number(value) || null;
  await saveDeal({ contact_ids: draft.contact_ids, primary_contact_id: draft.primary_contact_id });
};
const updateDealSource = async (value: string | number | (string | number)[] | null) => {
  draft.source = typeof value === 'string' ? value : '';
  await saveDeal({ source: draft.source });
};
const updateDealProject = async (value: string | number | (string | number)[] | null) => {
  draft.project_id = Number(value) || null;
  await saveDeal({ project_id: draft.project_id });
};
const isEditingDealTitle = ref(false);
const dealTitleInput = ref<HTMLTextAreaElement>();
const resizeDealTitleInput = () => {
  const input = dealTitleInput.value;
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
};
const startDealTitleEdit = async () => {
  isEditingDealTitle.value = true;
  await nextTick();
  resizeDealTitleInput();
  dealTitleInput.value?.focus();
  dealTitleInput.value?.setSelectionRange(draft.title.length, draft.title.length);
};
const cancelDealTitleEdit = () => {
  draft.title = deal.value?.title ?? draft.title;
  isEditingDealTitle.value = false;
};
const saveDealTitle = async () => {
  if (!draft.title.trim()) return;
  draft.title = draft.title.trim();
  await saveDeal({ title: draft.title });
  if (!error.value) isEditingDealTitle.value = false;
};
const changeStage = async (id: number, stageId: number) => {
  const stage = options.value?.stages.find((s) => s.id === stageId);
  if (!stage) return;
  if (stage.kind !== CrmStageKind.OPEN) {
    stageChange.value = { id, stage: stageId, kind: stage.kind };
    reason.value = '';
    projectChoice.value = CrmProjectChoice.NONE;
    stageDialog.value?.showModal();
    return;
  }
  await run(async () => {
    await $fetch(`/api/crm/deals/${id}`, {
      ...request,
      method: 'PATCH',
      body: { ...(panelId.value === id ? dealBody() : {}), stage_id: stageId },
    });
    if (panelId.value === id) savedFields = JSON.stringify(dealBody());
    await refreshAll();
  });
};
const finishStage = async () => {
  await run(async () => {
    const change = stageChange.value;
    if (!change) return;
    await $fetch(`/api/crm/deals/${change.id}`, {
      ...request,
      method: 'PATCH',
      body: {
        ...(panelId.value === change.id ? dealBody() : {}),
        stage_id: change.stage,
        loss_reason: reason.value || undefined,
        ...(projectChoice.value === CrmProjectChoice.EXISTING ? { project_id: selectedProject.value } : {}),
      },
    });
    if (panelId.value === change.id) savedFields = JSON.stringify(dealBody());
    if (change.kind === CrmStageKind.WON && projectChoice.value === CrmProjectChoice.NEW)
      await $fetch(`/api/crm/deals/${change.id}/project`, { ...request, method: 'POST' });
    stageDialog.value?.close();
    await refreshAll();
  });
};
const loadMore = async (column: CrmColumn) => {
  await run(async () => {
    const page = await $fetch<CrmColumn>(`/api/crm/columns/${column.stage.id}`, {
      ...request,
      query: { ...query.value, offset: column.cards.length },
    });
    const seen = new Set(column.cards.map((c) => c.id));
    column.cards.push(...page.cards.filter((c) => !seen.has(c.id)));
    column.has_more = page.has_more;
  });
};
const sendComment = async () => {
  if (!hasTiptapContent(comment.value)) return;
  await run(async () => {
    await $fetch(`/api/crm/deals/${panelId.value}/comments`, { ...request, method: 'POST', body: { message: comment.value } });
    comment.value = emptyDoc();
    commentEditor.value?.clearContent();
    await refreshDeal();
  });
};
const createTask = async () => {
  await run(async () => {
    await $fetch(`/api/crm/deals/${panelId.value}/tasks`, {
      ...request,
      method: 'POST',
      body: { title: taskTitle.value, planned_date: taskDate.value || undefined, responsible_id: taskOwner.value || undefined },
    });
    taskStore.invalidateTasksPage();
    taskTitle.value = '';
    taskDate.value = tomorrowDate();
    isTaskFormOpen.value = false;
    await refreshAll();
  });
};
let taskSearchRequest = 0;
const searchTasks = async () => {
  const query = taskSearch.value.trim();
  const requestId = ++taskSearchRequest;
  if (!query) {
    taskResults.value = [];
    taskSearchPending.value = false;
    return;
  }
  taskSearchPending.value = true;
  try {
    const linkedTaskIds = new Set(deal.value?.tasks.map((task) => task.id) ?? []);
    const results = await taskStore.searchTasks(query);
    if (requestId === taskSearchRequest) taskResults.value = results.filter((task) => !linkedTaskIds.has(task.id));
  } catch (cause) {
    if (requestId === taskSearchRequest) error.value = getErrorMessage(cause);
  } finally {
    if (requestId === taskSearchRequest) taskSearchPending.value = false;
  }
};
const debouncedSearchTasks = debounce(() => void searchTasks(), 300);
const handleTaskSearchInput = () => {
  if (!taskSearch.value.trim()) taskResults.value = [];
  debouncedSearchTasks();
};
const openTaskLink = async () => {
  isTaskLinkOpen.value = true;
  await nextTick();
  taskLinkInput.value?.focus();
};
const cancelTaskLink = () => {
  taskSearchRequest += 1;
  taskSearch.value = '';
  taskResults.value = [];
  taskSearchPending.value = false;
  isTaskLinkOpen.value = false;
};
const linkTask = async (id: number) => {
  await run(async () => {
    await $fetch(`/api/crm/deals/${panelId.value}/task-links`, { ...request, method: 'POST', body: { task_id: id } });
    cancelTaskLink();
    await refreshDeal();
  });
};
const openTask = async (id: number) => {
  savedScroll.value = panelElement.value?.scrollTop ?? 0;
  taskStore.currentTaskId = id;
  await router.push({ query: { ...route.query, 'task-id': id } });
};
watch(
  () => taskStore.currentTaskId,
  async (id, old) => {
    if (!id && old && panelId.value) {
      await refreshAll();
      await nextTick();
      if (panelElement.value) panelElement.value.scrollTop = savedScroll.value;
    }
  },
);
const completeTask = async (id: number) => {
  await run(async () => {
    await $fetch(`/api/tasks/${id}`, { ...request, method: 'PATCH', body: { status: 'closed' } });
    await refreshAll();
  });
};
watch(
  deal,
  (value) => {
    if (value) {
      if (value.id === syncedDealId && JSON.stringify(dealBody()) !== savedFields) return;
      Object.assign(draft, {
        ...value,
        amount: value.amount === null ? null : Number(value.amount),
        expected_close: value.expected_close ?? '',
      });
      syncedDealId = value.id;
      savedFields = JSON.stringify(dealBody());
    }
  },
  { immediate: true },
);

const { $webSocket } = useNuxtApp();
const refreshFromEvent = () => {
  if (!busy.value) void refreshAll();
};
onMounted(() => {
  $webSocket?.on('crm:changed', refreshFromEvent);
  window.addEventListener('focus', refreshFromEvent);
});
onBeforeUnmount(() => {
  $webSocket?.off('crm:changed', refreshFromEvent);
  window.removeEventListener('focus', refreshFromEvent);
});
const selectStage = (value: string | number | (string | number)[] | null) => {
  if (typeof value === 'number') void changeStage(panelId.value, value);
};
</script>

<template>
  <main class="crm">
    <header class="crm__header">
      <div>
        <h1>CRM</h1>
        <p>Сделки и клиентская база</p>
      </div>
      <button
        class="crm__primary"
        @click="
          section === CrmSection.DEALS
            ? openNewDealDialog()
            : openDirectory(section === CrmSection.COMPANIES ? CrmPanel.COMPANY : CrmPanel.CONTACT)
        "
      >
        <Plus :size="20" :stroke-width="1.75" aria-hidden="true" />
        {{
          section === CrmSection.DEALS ? 'Новая сделка' : section === CrmSection.COMPANIES ? 'Новая компания' : 'Новый контакт'
        }}
      </button>
    </header>
    <nav class="crm__tabs" aria-label="Разделы CRM">
      <NuxtLink
        v-for="tab in [
          { key: CrmSection.DEALS, label: 'Сделки' },
          { key: CrmSection.COMPANIES, label: 'Компании' },
          { key: CrmSection.CONTACTS, label: 'Контакты' },
        ]"
        :key="tab.key"
        :to="`/crm/${tab.key}`"
        :aria-current="section === tab.key ? 'page' : undefined"
        >{{ tab.label }}</NuxtLink
      >
    </nav>
    <div class="crm__filters" aria-label="Фильтры CRM">
      <TaskFilterPanel
        ref="crmFilterPanel"
        :filters="crmFilterChips"
        :filter-definitions="crmFilterDefinitions"
        :show-export="false"
        :search-placeholder="section === CrmSection.DEALS ? 'Поиск по сделкам' : 'Название или имя'"
        @add-filter="addCrmFilter"
        @search="handleCrmSearch"
        @remove-filter="removeCrmFilter"
      />
      <label
        v-if="section === CrmSection.DEALS"
        class="crm__mine-filter"
        :class="{ 'crm__mine-filter_active': isMineFilterActive }"
      >
        <input type="checkbox" :checked="isMineFilterActive" @change="toggleMineFilter" />
        <span>Мои</span>
      </label>
      <span v-if="pending" class="crm__loading" role="status">Обновление…</span>
    </div>
    <div v-if="crmFilterChips.length" class="crm__filter-chips">
      <div v-for="chip in crmFilterChips" :key="chip.id" class="crm__filter-chip">
        <span class="crm__filter-chip-label">{{ chip.label }}</span>
        <button
          type="button"
          class="crm__filter-chip-remove"
          :aria-label="`Убрать фильтр «${chip.label}»`"
          @click="removeCrmFilter(chip.id)"
        >
          <IconsIconCloseFilter aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="error" role="alert" class="crm__error">{{ error }}</p>
    <div
      v-if="section === CrmSection.DEALS"
      class="crm__board"
      :class="{ crm__board_dragging: isBoardDragging }"
      aria-label="Воронка сделок"
      @pointerdown="onBoardPointerDown"
      @pointermove="onBoardPointerMove"
      @pointerup="onBoardPointerEnd"
      @pointercancel="onBoardPointerEnd"
    >
      <section
        v-for="column in board"
        :key="column.stage.id"
        class="crm__column"
        :class="{ crm__column_collapsed: collapsed.includes(column.stage.id) }"
        :style="{ '--crm-stage-color': stageColor(column.stage) }"
        @dragover.prevent
        @drop.prevent="
          dragging && changeStage(dragging, column.stage.id);
          dragging = null;
        "
      >
        <button
          v-if="collapsed.includes(column.stage.id)"
          class="crm__column-collapsed"
          type="button"
          :aria-label="`Развернуть этап «${column.stage.name}»`"
          aria-expanded="false"
          @click="setStageCollapsed(column.stage.id, false)"
        >
          <ChevronRight :size="16" :stroke-width="2" aria-hidden="true" />
          <span class="crm__column-count">{{ column.total }}</span>
          <span class="crm__column-collapsed-title"><i></i>{{ column.stage.name }}</span>
        </button>
        <div v-else class="crm__column-heading">
          <div class="crm__column-heading-main">
            <i></i>
            <strong :title="column.stage.name">{{ column.stage.name }}</strong>
            <span class="crm__column-heading-count">{{ column.total }}</span>
            <button
              type="button"
              :aria-label="`Свернуть этап «${column.stage.name}»`"
              title="Свернуть колонку"
              @click="setStageCollapsed(column.stage.id, true)"
            >
              <ChevronLeft :size="16" :stroke-width="2" aria-hidden="true" />
            </button>
          </div>
          <div class="crm__column-meta">
            <b>{{ money(column.amount) }}</b>
          </div>
        </div>
        <div v-if="!collapsed.includes(column.stage.id)" class="crm__cards">
          <BaseKanbanCard
            v-for="card in column.cards"
            :key="card.id"
            draggable="true"
            @dragstart="dragging = card.id"
            @dragend="dragging = null"
            @click="openDeal(card.id)"
          >
            <template #header>
              <span>{{ card.company_name || 'Без компании' }}</span>
              <b>{{ money(card.amount) }}</b>
            </template>
            <template #title>{{ card.title }}</template>
            <template #description>
              <span class="crm__card-owner">
                <UserRound :size="14" :stroke-width="1.75" aria-hidden="true" />{{ card.responsible_name || 'Не назначен' }}
              </span>
            </template>
            <template v-if="card.next_task || column.stage.kind === CrmStageKind.OPEN" #footer>
              <span
                v-if="card.next_task"
                class="crm__next"
                :class="{ crm__next_overdue: card.next_task.planned_date && card.next_task.planned_date < today() }"
              >
                <CalendarDays :size="14" :stroke-width="1.75" aria-hidden="true" />
                <span
                  >{{ card.next_task.planned_date && card.next_task.planned_date < today() ? 'Просрочено · ' : ''
                  }}{{ card.next_task.planned_date || 'Без даты' }} · {{ card.next_task.title }}</span
                >
              </span>
              <span v-else class="crm__next crm__next_empty">
                <CalendarDays :size="14" :stroke-width="1.75" aria-hidden="true" />Следующий шаг не запланирован
              </span>
            </template>
          </BaseKanbanCard>
          <button v-if="column.has_more" :disabled="busy" @click="loadMore(column)">Показать ещё</button>
        </div>
      </section>
    </div>
    <div v-else class="crm__directory">
      <span class="crm__directory-count">
        {{ section === CrmSection.COMPANIES ? sortedCompanies.length : sortedContacts.length }} записей
      </span>
      <div v-if="section === CrmSection.COMPANIES && sortedCompanies.length" class="crm__table-wrap">
        <table class="crm__table">
          <thead>
            <tr>
              <th
                v-for="column of companyColumns"
                :key="column.key"
                :aria-sort="getDirectoryAriaSort(column.key, companySortKey, companySortDirection)"
              >
                <button
                  type="button"
                  class="crm__sort-button"
                  :class="{ 'crm__sort-button_active': companySortKey === column.key }"
                  :aria-label="getDirectorySortLabel(column.key, column.label, companySortKey, companySortDirection)"
                  @click="toggleCompanySort(column.key)"
                >
                  <span>{{ column.label }}</span>
                  <ArrowUpDown v-if="companySortKey !== column.key" :size="16" aria-hidden="true" />
                  <ArrowUp v-else-if="companySortDirection === 'asc'" :size="16" aria-hidden="true" />
                  <ArrowDown v-else :size="16" aria-hidden="true" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="company in sortedCompanies" :key="company.id">
              <td>
                <button class="crm__directory-link" @click="openDirectory(CrmPanel.COMPANY, company.id)">
                  {{ company.name }}
                </button>
              </td>
              <td>{{ company.website || 'Не указан' }}</td>
              <td>{{ ownerName(company.responsible_id) }}</td>
              <td>{{ stats(company.id).count }}</td>
              <td>{{ money(stats(company.id).amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="section === CrmSection.CONTACTS && sortedContacts.length" class="crm__table-wrap">
        <table class="crm__table">
          <thead>
            <tr>
              <th
                v-for="column of contactColumns"
                :key="column.key"
                :aria-sort="getDirectoryAriaSort(column.key, contactSortKey, contactSortDirection)"
              >
                <button
                  type="button"
                  class="crm__sort-button"
                  :class="{ 'crm__sort-button_active': contactSortKey === column.key }"
                  :aria-label="getDirectorySortLabel(column.key, column.label, contactSortKey, contactSortDirection)"
                  @click="toggleContactSort(column.key)"
                >
                  <span>{{ column.label }}</span>
                  <ArrowUpDown v-if="contactSortKey !== column.key" :size="16" aria-hidden="true" />
                  <ArrowUp v-else-if="contactSortDirection === 'asc'" :size="16" aria-hidden="true" />
                  <ArrowDown v-else :size="16" aria-hidden="true" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="contact in sortedContacts" :key="contact.id">
              <td>
                <button class="crm__directory-link" @click="openDirectory(CrmPanel.CONTACT, contact.id)">
                  {{ contactFullName(contact) }}
                </button>
              </td>
              <td>{{ companyName(contact.company_id) }}</td>
              <td>{{ contact.position || 'Не указана' }}</td>
              <td class="crm__communication">
                <span>{{ contact.phone || 'Телефон не указан' }}</span>
                <span>{{ contact.email || 'Email не указан' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!(section === CrmSection.COMPANIES ? companies.length : contacts.length)" class="crm__empty">
        Ничего не найдено. Измените поиск или добавьте запись.
      </p>
    </div>

    <div
      v-if="panel === CrmPanel.DEAL && !taskStore.currentTaskId"
      class="crm__panel-backdrop"
      aria-hidden="true"
      @click="closePanel"
    ></div>
    <aside
      v-if="panel === CrmPanel.DEAL"
      v-show="!taskStore.currentTaskId"
      ref="panelElement"
      class="crm__panel"
      :class="{ crm__panel_expanded: expanded }"
      role="dialog"
      aria-modal="true"
      aria-label="Карточка сделки"
      :aria-hidden="directoryPanel ? 'true' : undefined"
      :inert="directoryPanel ? true : undefined"
      @keydown.esc="closePanel"
    >
      <div v-if="isDealInitialLoading" class="loader__wrapper">
        <div class="loader" role="status" aria-label="Загрузка сделки"></div>
      </div>
      <header v-else class="crm__panel-header crm__panel-header_deal">
        <div class="crm__panel-topbar">
          <span>Сделка</span>
          <button class="crm__panel-close" aria-label="Закрыть панель" title="Закрыть" @click="closePanel">
            <X :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>
        <div class="crm__panel-heading">
          <form v-if="isEditingDealTitle" class="crm__panel-title-form" @submit.prevent="saveDealTitle">
            <textarea
              ref="dealTitleInput"
              v-model="draft.title"
              aria-label="Название сделки"
              required
              maxlength="200"
              rows="1"
              placeholder="Введите название"
              @input="resizeDealTitleInput"
              @keydown.enter.prevent="saveDealTitle"
              @keydown.esc.prevent="cancelDealTitleEdit"
            ></textarea>
            <div class="crm__panel-title-actions">
              <button
                type="submit"
                class="crm__panel-title-save"
                :disabled="busy || !draft.title.trim()"
                aria-label="Сохранить название"
              >
                {{ busy ? 'Сохранение…' : 'Сохранить' }}
              </button>
              <button
                type="button"
                class="crm__panel-title-cancel"
                :disabled="busy"
                aria-label="Отменить изменение названия"
                title="Отменить"
                @click="cancelDealTitleEdit"
              >
                <X :size="20" :stroke-width="1.75" aria-hidden="true" />
              </button>
            </div>
          </form>
          <h2
            v-else
            id="crm-deal-title"
            class="crm__panel-title"
            title="Дважды нажмите, чтобы изменить"
            @dblclick="startDealTitleEdit"
          >
            {{ deal?.title }}
          </h2>
        </div>
        <div class="crm__panel-actions" aria-label="Действия со сделкой">
          <button
            class="crm__panel-expand"
            :aria-label="expanded ? 'Свернуть панель' : 'Расширить панель'"
            :title="expanded ? 'Свернуть' : 'Расширить'"
            @click="expanded = !expanded"
          >
            <Minimize2 v-if="expanded" :size="20" :stroke-width="1.75" aria-hidden="true" />
            <Expand v-else :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <button aria-label="Копировать ссылку" title="Копировать ссылку" @click="copyLink">
            <Copy :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <button
            class="crm__panel-delete"
            aria-label="Удалить сделку"
            title="Удалить сделку"
            :disabled="busy"
            @click="isDeleteDealConfirmOpen = true"
          >
            <Trash2 :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>
      </header>
      <p v-if="!isDealInitialLoading && error" class="crm__error" role="alert">{{ error }}</p>
      <p v-if="!isDealInitialLoading && dealError && !isCurrentDeal" role="alert">
        Не удалось открыть сделку. <button @click="refreshDeal()">Повторить</button>
      </p>
      <template v-else-if="!isDealInitialLoading && isCurrentDeal && deal">
        <p v-if="deal.loss_reason" class="crm__deal-loss-reason">Причина проигрыша: {{ deal.loss_reason }}</p>
        <div class="crm__deal-content">
          <div class="crm__deal-main">
            <section class="crm__section crm__section_tasks" aria-labelledby="crm-tasks-title">
              <div class="crm__section-header">
                <h3 id="crm-tasks-title">Привязанные задачи</h3>
                <label class="crm__check"><input v-model="showCompleted" type="checkbox" />Показать завершённые</label>
              </div>
              <div v-for="t in tasks" :key="t.id" class="crm__task">
                <button @click="openTask(t.id)">
                  {{ t.title }}
                  <small
                    >{{ t.planned_date || 'Без даты' }} ·
                    {{ t.status === 'closed' ? 'Закрыта' : t.status === 'in_progress' ? 'Выполняется' : 'К выполнению' }}</small
                  >
                </button>
                <button v-if="t.status !== 'closed'" :disabled="busy" @click="completeTask(t.id)">Завершить</button>
              </div>
              <div class="crm__link-task">
                <button
                  v-if="!isTaskLinkOpen"
                  type="button"
                  class="crm__link-task-trigger"
                  aria-controls="crm-task-link-form"
                  :aria-expanded="isTaskLinkOpen"
                  @click="openTaskLink"
                >
                  <Plus :size="16" :stroke-width="1.75" aria-hidden="true" />
                  <span>Привязать существующую задачу</span>
                </button>
                <div v-else id="crm-task-link-form" class="crm__link-task-editor">
                  <div class="crm__link-task-input">
                    <input
                      ref="taskLinkInput"
                      v-model="taskSearch"
                      :maxlength="MAX_TASK_NAME_LENGTH"
                      type="search"
                      role="combobox"
                      autocomplete="off"
                      placeholder="Найдите существующую задачу"
                      aria-label="Поиск существующей задачи"
                      aria-autocomplete="list"
                      aria-controls="crm-task-link-results"
                      :aria-expanded="Boolean(taskSearchPending || taskSearch.trim())"
                      @input="handleTaskSearchInput"
                      @keydown.escape="cancelTaskLink"
                    />
                    <div
                      v-if="taskSearchPending || taskSearch.trim()"
                      id="crm-task-link-results"
                      class="crm__link-task-dropdown"
                      role="listbox"
                      aria-label="Результаты поиска задач"
                    >
                      <span v-if="taskSearchPending" class="crm__link-task-state" role="status">Поиск…</span>
                      <template v-else>
                        <button
                          v-for="task in taskResults"
                          :key="task.id"
                          type="button"
                          class="crm__link-task-result"
                          role="option"
                          :disabled="busy"
                          @click="linkTask(task.id)"
                        >
                          {{ task.title }}
                        </button>
                        <span v-if="!taskResults.length" class="crm__link-task-state" role="status">
                          Подходящих задач не найдено
                        </span>
                      </template>
                    </div>
                  </div>
                  <div class="crm__link-task-actions">
                    <button type="button" class="button button_secondary" :disabled="busy" @click="cancelTaskLink">
                      Отменить
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="crm__comments">
              <div class="crm__comments-header">
                <span>Действия</span>
                <div class="crm__comments-tools">
                  <button
                    class="crm__comments-add"
                    type="button"
                    :aria-expanded="isTaskFormOpen"
                    @click="isTaskFormOpen ? closeTaskForm() : openTaskForm()"
                  >
                    <Plus :size="16" :stroke-width="1.75" aria-hidden="true" />
                    {{ isTaskFormOpen ? 'Отменить' : 'Добавить' }}
                  </button>
                  <button class="crm__comments-sort" type="button" @click="toggleTimelineSort">
                    <span>{{ TYPE_SORT_LABELS[timelineSort] }}</span>
                    <IconSortAsc v-if="timelineSort === TypeSort.ASC" aria-hidden="true" />
                    <IconSortDesc v-else aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p class="crm__next-action" :class="{ 'crm__next-action_empty': !deal.next_task }">
                <CalendarDays :size="18" :stroke-width="1.75" aria-hidden="true" />
                <span v-if="deal.next_task"
                  >Следующее действие: {{ deal.next_task.title }} · {{ deal.next_task.planned_date || 'без даты' }}</span
                >
                <span v-else>Следующий шаг не запланирован</span>
              </p>
              <form v-if="isTaskFormOpen" class="crm__inline-form" @submit.prevent="createTask" @keydown.esc.stop="closeTaskForm">
                <label class="crm__inline-form-title">
                  <span>Название задачи</span>
                  <input
                    ref="taskTitleInput"
                    v-model="taskTitle"
                    required
                    minlength="3"
                    maxlength="150"
                    placeholder="Что нужно сделать"
                  />
                </label>
                <label>
                  <span>Ответственный</span>
                  <BaseSelect
                    v-model="taskOwner"
                    :options="responsibleOptions"
                    placeholder="Выберите ответственного"
                    large
                    arrow
                  />
                </label>
                <label>
                  <span>Дата</span>
                  <input v-model="taskDate" type="date" required />
                </label>
                <button class="crm__primary" :disabled="busy">
                  <Plus :size="18" :stroke-width="1.75" aria-hidden="true" />Создать
                </button>
              </form>
              <div v-if="timelineSort === TypeSort.DESC" class="crm__comments-form">
                <div class="crm__comments-input">
                  <EditorTiptap
                    :key="`comment-${deal.id}-top`"
                    ref="commentEditor"
                    v-model="comment"
                    placeholder="Напишите комментарий..."
                    :value="comment"
                    :is-editable="true"
                    :file-prefix="`crm/deals/${deal.id}/`"
                    :mention-users="crmMentionUsers"
                    @enter="sendComment"
                  />
                  <button class="crm__primary" :disabled="busy || !hasTiptapContent(comment)" @click="sendComment">
                    Отправить
                  </button>
                </div>
              </div>
              <div v-if="timeline.length" class="crm__comments-body crm__comments-body_timeline">
                <div
                  v-for="activity in timeline"
                  :key="activity.id"
                  class="crm__comments-event"
                  :class="{ 'crm__comments-event_comment': activity.kind === CrmActivityKind.COMMENT }"
                >
                  <article v-if="activity.kind === CrmActivityKind.COMMENT" class="crm__timeline-comment">
                    <span class="crm__timeline-avatar" aria-hidden="true">{{ authorInitials(activity.author_name) }}</span>
                    <div class="crm__timeline-comment-content">
                      <header>
                        <span>{{ activity.author_name }}</span>
                        <time :datetime="activity.created_at">{{ formatCommentDate(activity.created_at) }}</time>
                      </header>
                      <EditorTiptap
                        v-if="activity.message"
                        :value="activity.message"
                        :model-value="activity.message"
                        :is-editable="false"
                      />
                    </div>
                  </article>
                  <article v-else class="crm__timeline-activity">
                    <History class="crm__timeline-activity-icon" :size="16" aria-hidden="true" />
                    <div class="crm__timeline-activity-content">
                      <header>
                        <strong>{{ activity.author_name }}</strong>
                        <time :datetime="activity.created_at" :title="formatActivityDate(activity.created_at)">
                          {{ formatActivityDate(activity.created_at) }}
                        </time>
                      </header>
                      <div>{{ activity.summary }}</div>
                    </div>
                  </article>
                </div>
              </div>
              <div v-else class="crm__comments-body">Комментариев и действий пока нет</div>
              <div v-if="timelineSort === TypeSort.ASC" class="crm__comments-form">
                <div class="crm__comments-input">
                  <EditorTiptap
                    :key="`comment-${deal.id}-bottom`"
                    ref="commentEditor"
                    v-model="comment"
                    placeholder="Напишите комментарий..."
                    :value="comment"
                    :is-editable="true"
                    :file-prefix="`crm/deals/${deal.id}/`"
                    :mention-users="crmMentionUsers"
                    @enter="sendComment"
                  />
                  <button class="crm__primary" :disabled="busy || !hasTiptapContent(comment)" @click="sendComment">
                    Отправить
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div id="crm-deal-fields" class="crm__deal-meta" :aria-busy="busy">
            <label
              >Этап<BaseDropdown
                :model-value="deal.stage_id"
                :options="stageOptions"
                placeholder="Этап"
                :disabled="busy"
                @update:model-value="selectStage"
            /></label>
            <label
              >Сумма, ₽<input
                :value="draft.amount ?? ''"
                type="number"
                min="0"
                max="9999999999.99"
                step="0.01"
                placeholder="Не указана"
                :disabled="busy"
                @change="updateDealAmount"
            /></label>
            <label
              >Ответственный<BaseDropdown
                :model-value="draft.responsible_id"
                :options="dealResponsibleOptions"
                placeholder="Не назначен"
                :disabled="busy"
                @update:model-value="updateDealResponsible"
            /></label>
            <div class="crm__deal-meta-field">
              <span>Компания</span>
              <div class="crm__deal-company-control">
                <BaseSelect
                  :model-value="draft.company_id"
                  :options="optionalCompanyOptions"
                  placeholder="Без компании"
                  large
                  arrow
                  searchable
                  search-placeholder="Поиск компании"
                  action-label="Добавить компанию"
                  :disabled="busy"
                  @update:model-value="updateDealCompany"
                  @action="openDirectory(CrmPanel.COMPANY, 0, true)"
                />
                <button
                  v-if="draft.company_id"
                  class="crm__deal-company-open"
                  type="button"
                  aria-label="Открыть компанию"
                  title="Открыть компанию"
                  :disabled="busy"
                  @click="openDirectory(CrmPanel.COMPANY, draft.company_id, true)"
                >
                  <ExternalLink :size="16" :stroke-width="1.75" aria-hidden="true" />
                </button>
              </div>
            </div>
            <label
              >Контактное лицо<BaseSelect
                :model-value="selectedContactId"
                :options="dealContactOptions"
                placeholder="Контактное лицо не выбрано"
                large
                arrow
                searchable
                search-placeholder="Поиск контакта"
                action-label="Добавить контакт"
                :disabled="busy"
                @update:model-value="updateDealContact"
                @action="openDirectory(CrmPanel.CONTACT, 0, true)"
            /></label>
            <address v-if="selectedContact" class="crm__deal-contact-summary">
              <strong>{{ contactFullName(selectedContact) }}</strong>
              <a v-if="selectedContact.phone" :href="`tel:${selectedContact.phone}`">
                <Phone :size="16" :stroke-width="1.75" aria-hidden="true" />
                <span>{{ selectedContact.phone }}</span>
              </a>
              <a v-if="selectedContact.email" :href="`mailto:${selectedContact.email}`">
                <Mail :size="16" :stroke-width="1.75" aria-hidden="true" />
                <span>{{ selectedContact.email }}</span>
              </a>
              <a v-if="selectedContact.telegram" :href="selectedContactTelegramHref" target="_blank" rel="noopener noreferrer">
                <Send :size="16" :stroke-width="1.75" aria-hidden="true" />
                <span>{{ selectedContact.telegram }}</span>
              </a>
              <span v-if="!hasSelectedContactChannels" class="crm__deal-contact-empty">Контактные данные не указаны</span>
            </address>
            <label
              >Источник заявки<BaseSelect
                :model-value="draft.source"
                :options="optionalSourceOptions"
                placeholder="Источник не определён"
                large
                arrow
                :disabled="busy"
                @update:model-value="updateDealSource"
            /></label>
            <label
              >Проект<BaseDropdown
                :model-value="draft.project_id"
                :options="dealProjectOptions"
                placeholder="Без проекта"
                :disabled="busy"
                @update:model-value="updateDealProject"
            /></label>
          </div>
        </div>
      </template>
    </aside>

    <Teleport to="body">
      <BaseModal v-model="isDeleteDealConfirmOpen" :dismissible="!busy">
        <div class="crm-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="crm-delete-deal-title">
          <h2 id="crm-delete-deal-title">Удалить сделку?</h2>
          <p>Сделка "{{ deal?.title }}" будет удалена. Привязанные задачи останутся в трекере без связи со сделкой.</p>
          <p v-if="error" class="crm-delete-confirm__error" role="alert">{{ error }}</p>
          <div class="crm-delete-confirm__actions">
            <button class="button button_secondary" type="button" :disabled="busy" @click="isDeleteDealConfirmOpen = false">
              Отмена
            </button>
            <button class="button crm-delete-confirm__submit" type="button" :disabled="busy" @click="deleteDeal">
              {{ busy ? 'Удаление…' : 'Удалить' }}
            </button>
          </div>
        </div>
      </BaseModal>
    </Teleport>

    <div
      v-if="directoryPanel && !taskStore.currentTaskId"
      class="crm__directory-backdrop"
      aria-hidden="true"
      @click="closeDirectory"
    ></div>
    <aside
      v-if="directoryPanel"
      v-show="!taskStore.currentTaskId"
      ref="directoryElement"
      class="crm__panel crm__panel_directory"
      role="dialog"
      aria-modal="true"
      :aria-label="directoryTitle"
      @keydown.esc="closeDirectory"
    >
      <header class="crm__panel-header">
        <button v-if="returnToDeal" aria-label="Назад к сделке" title="Назад к сделке" @click="closeDirectory">
          <ChevronLeft :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <span>{{ returnToDeal ? 'Назад к сделке' : directoryTitle }}</span>
        <button
          v-if="directoryEntityId"
          class="crm__panel-delete"
          type="button"
          :aria-label="directoryPanel === CrmPanel.COMPANY ? 'Удалить компанию' : 'Удалить контакт'"
          :title="directoryPanel === CrmPanel.COMPANY ? 'Удалить компанию' : 'Удалить контакт'"
          :disabled="busy"
          @click="openDeleteDirectoryConfirm"
        >
          <Trash2 :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <button v-if="!returnToDeal" aria-label="Закрыть окно" title="Закрыть" @click="closeDirectory">
          <X :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </header>
      <p v-if="error" class="crm__error" role="alert">{{ error }}</p>
      <form v-if="directoryPanel === CrmPanel.COMPANY" class="crm__form" @submit.prevent="saveDirectory">
        <h2>{{ companyForm.id ? companyForm.name : 'Новая компания' }}</h2>
        <div class="crm__fields">
          <label
            ><span>Название<span class="crm__required" aria-hidden="true">*</span></span
            ><input v-model="companyForm.name" required aria-required="true" maxlength="200"
          /></label>
          <label>Юридическое название<input v-model="companyForm.legal_name" /></label>
          <label>ИНН<input v-model="companyForm.inn" maxlength="20" /></label>
          <label>Сайт<input v-model="companyForm.website" /></label>
          <label
            >Ответственный<BaseSelect
              v-model="companyForm.responsible_id"
              :options="optionalResponsibleOptions"
              placeholder="Не назначен"
              large
              arrow
          /></label>
          <label class="crm__field_full">Примечания<textarea v-model="companyForm.notes" rows="4" /></label>
        </div>
        <button class="crm__primary" :disabled="busy || !isCompanyFormValid">Сохранить</button>
        <h3>Контакты</h3>
        <button
          v-for="c in companyContacts"
          :key="c.id"
          type="button"
          @click="openDirectory(CrmPanel.CONTACT, c.id, returnToDeal)"
        >
          {{ contactFullName(c) }} · {{ c.position }}
        </button>
        <p v-if="!companyContacts.length" class="crm__form-empty">У компании пока нет контактов</p>
      </form>
      <form v-else class="crm__form" @submit.prevent="saveDirectory">
        <h2>{{ contactForm.id ? contactFullName(contactForm) : 'Новый контакт' }}</h2>
        <div class="crm__fields">
          <label
            ><span>Имя<span class="crm__required" aria-hidden="true">*</span></span
            ><input v-model="contactForm.name" required aria-required="true" maxlength="200"
          /></label>
          <label>Фамилия<input v-model="contactForm.last_name" maxlength="200" /></label>
          <label>Отчество<input v-model="contactForm.patronymic" maxlength="200" /></label>
          <label
            >Компания<BaseSelect
              v-model="contactForm.company_id"
              :options="optionalCompanyOptions"
              placeholder="Без компании"
              large
              arrow
              searchable
              search-placeholder="Поиск компании"
          /></label>
          <label>Должность<input v-model="contactForm.position" /></label>
          <label>Телефон<input v-model="contactForm.phone" type="tel" /></label>
          <label>Email<input v-model="contactForm.email" type="email" /></label>
          <label>Telegram<input v-model="contactForm.telegram" /></label>
        </div>
        <button class="crm__primary" :disabled="busy || !isContactFormValid">Сохранить</button>
      </form>
      <section class="crm__section">
        <h3>Сделки и проекты</h3>
        <p v-if="!relatedDeals.length">Связанных сделок пока нет</p>
        <div v-for="d in relatedDeals" :key="d.id">
          <button @click="openDeal(d.id)">{{ d.title }} · {{ money(d.amount) }}</button>
          <p v-if="d.project_id">Проект: {{ options?.projects.find((p) => p.id === d.project_id)?.name }}</p>
        </div>
      </section>
    </aside>
    <Teleport to="body">
      <BaseModal v-model="isDeleteDirectoryConfirmOpen" :dismissible="!busy">
        <div class="crm-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="crm-delete-directory-title">
          <h2 id="crm-delete-directory-title">
            {{ directoryPanel === CrmPanel.COMPANY ? 'Удалить компанию?' : 'Удалить контакт?' }}
          </h2>
          <p v-if="directoryPanel === CrmPanel.COMPANY">
            Компания "{{ directoryEntityName }}" будет удалена. Контакты и сделки сохранятся без связи с компанией.
          </p>
          <p v-else>Контакт "{{ directoryEntityName }}" будет удалён из CRM и отвязан от сделок. Сами сделки сохранятся.</p>
          <p v-if="error" class="crm-delete-confirm__error" role="alert">{{ error }}</p>
          <div class="crm-delete-confirm__actions">
            <button class="button button_secondary" type="button" :disabled="busy" @click="isDeleteDirectoryConfirmOpen = false">
              Отмена
            </button>
            <button class="button crm-delete-confirm__submit" type="button" :disabled="busy" @click="deleteDirectory">
              {{ busy ? 'Удаление…' : 'Удалить' }}
            </button>
          </div>
        </div>
      </BaseModal>
    </Teleport>
    <dialog ref="newDealDialog" class="crm__dialog">
      <form @submit.prevent="createDeal">
        <h2>Новая сделка</h2>
        <label
          ><span>Название<span class="crm__required" aria-hidden="true">*</span></span
          ><input
            v-model="newTitle"
            required
            aria-required="true"
            maxlength="200"
            autofocus
            placeholder="Введите название сделки"
        /></label>
        <label
          >Компания<BaseSelect
            :model-value="newDealCompanyId"
            :options="optionalCompanyOptions"
            placeholder="Без компании"
            large
            arrow
            searchable
            search-placeholder="Поиск компании"
            @update:model-value="selectNewDealCompany"
        /></label>
        <label
          >Контактное лицо<BaseSelect
            :model-value="newDealContactId"
            :options="optionalContactOptions"
            placeholder="Контактное лицо не выбрано"
            large
            arrow
            searchable
            search-placeholder="Поиск контакта"
            @update:model-value="selectNewDealContact"
        /></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="crm__actions">
          <button type="button" @click="newDealDialog?.close()">Отмена</button
          ><button class="crm__primary" :disabled="busy || !newTitle.trim()">{{ busy ? 'Создание…' : 'Создать' }}</button>
        </div>
      </form>
    </dialog>
    <dialog ref="stageDialog" class="crm__dialog" @close="stageChange = null">
      <form @submit.prevent="finishStage">
        <h2>{{ stageChange?.kind === CrmStageKind.LOST ? 'Завершить с проигрышем' : 'Успешная сделка' }}</h2>
        <label v-if="stageChange?.kind === CrmStageKind.LOST"
          >Причина проигрыша<select v-model="reason" required>
            <option value="">Выберите причину</option>
            <option v-for="r in options?.loss_reasons" :key="r">{{ r }}</option>
          </select></label
        ><template v-else
          ><label
            >Проект<select v-model="projectChoice">
              <option :value="CrmProjectChoice.NONE">Продолжить без проекта</option>
              <option :value="CrmProjectChoice.NEW">Создать новый проект</option>
              <option :value="CrmProjectChoice.EXISTING">Выбрать существующий</option>
            </select></label
          ><label v-if="projectChoice === CrmProjectChoice.EXISTING"
            >Существующий проект<select v-model="selectedProject" required>
              <option :value="null">Выберите проект</option>
              <option v-for="p in options?.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select></label
          ></template
        >
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="crm__actions">
          <button
            type="button"
            @click="
              stageDialog?.close();
              refreshDeal();
            "
          >
            Отмена</button
          ><button class="crm__primary" :disabled="busy">Подтвердить</button>
        </div>
      </form>
    </dialog>
  </main>
</template>

<style scoped lang="scss">
.crm {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  overflow: hidden;
  color: var(--light-text-backgroung-primary);
  @include flex(cn);
  gap: 12px;
  @extend %text-s-regular;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }
  h2 {
    margin: 0;
    @extend %display-s-bold;
    overflow-wrap: anywhere;
  }
  h3 {
    margin: 0;
    @extend %text-m-medium;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
    min-width: 0;
  }

  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  :is(button, input, select, textarea, a):focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  option {
    background: var(--dark-text-background-primary);
  }
  label {
    min-width: 0;
  }
  small {
    display: block;
    color: var(--light-text-backgroung-primary-50);
  }

  input:not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: transparent;
    text-align: left;
  }

  select {
    text-align-last: left;
  }

  textarea {
    resize: vertical;
  }

  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    accent-color: var(--primary);
  }

  &__header,
  &__actions,
  &__tabs {
    @include flex(rw, a-center);
    gap: 8px;
  }

  &__header {
    justify-content: space-between;
    gap: 24px;

    > div {
      min-width: 0;
    }

    p {
      margin: 4px 0 0;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
  }

  &__primary {
    @include flex(rn, a-center);
    gap: 8px;
    min-height: 40px;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: var(--primary) !important;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;

    &:hover:not(:disabled) {
      background: var(--primary-hover) !important;
    }
  }

  &__tabs {
    min-height: 40px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    a {
      height: 40px;
      padding: 8px 4px;
      color: var(--light-text-backgroung-primary-50);
      text-decoration: none;
      border-bottom: 1px solid transparent;

      &[aria-current='page'] {
        border-color: var(--primary);
        color: var(--light-text-backgroung-primary);
      }
      &:hover {
        color: var(--light-text-backgroung-primary);
      }
    }
  }

  &__filters {
    min-width: 0;
    flex-shrink: 0;
    @include flex(rn, a-center);
    gap: 8px;

    :deep(.task-filter-panel) {
      width: min(760px, 100%);
    }

    :deep(.task-filter-panel__right input:focus-visible) {
      outline: none;
      outline-offset: 0;
      box-shadow: none;
    }

    @media (max-width: $screen-mobile-l) {
      flex-wrap: wrap;
    }
  }

  &__mine-filter {
    flex-shrink: 0;
    padding: 8px 10px;
    gap: 8px;
    border: 1px solid var(--primary-50);
    border-radius: 8px;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    user-select: none;
    transition:
      color 0.2s,
      background 0.2s,
      border-color 0.2s;
    @include flex(rn, a-center);
    @extend %text-s-medium;

    input {
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      accent-color: var(--primary);
      cursor: pointer;
    }

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--primary-5);
    }

    &_active {
      color: var(--light-text-backgroung-primary);
      background: var(--primary-10);
      border-color: var(--primary);
    }
  }

  &__filter-chips {
    flex-shrink: 0;
    @include flex(rw, a-center);
    gap: 6px;

    @media (max-width: $screen-mobile-l) {
      width: 100%;
      min-width: 0;
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;

      &::-webkit-scrollbar {
        display: none;
      }
    }
  }

  &__filter-chip {
    height: 24px;
    padding: 2px 4px;
    border-radius: 4px;
    background: var(--primary-25);
    @include flex(rn, a-center);
    gap: 2px;

    @media (max-width: $screen-mobile-l) {
      flex: 0 0 auto;
    }
  }

  &__filter-chip-label {
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    @extend %text-s-regular;
  }

  &__filter-chip-remove {
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: transparent;
    @include flex(center);

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__loading {
    margin-left: 4px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__board {
    min-height: 0;
    flex: 1;
    width: 100%;
    padding: 4px 2px 8px;
    overflow-x: auto;
    cursor: grab;
    scroll-padding-inline: 2px;
    @include flex(rn, stretch);
    gap: 0;

    &_dragging {
      cursor: grabbing;
      user-select: none;

      * {
        cursor: grabbing !important;
      }
    }
  }

  &__column {
    position: relative;
    flex: 0 0 300px;
    width: 300px;
    min-width: 300px;
    max-width: 300px;
    height: 100%;
    padding: 0 8px;
    gap: 8px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn, a-start);

    &:first-child {
      padding-left: 0;
    }

    &:last-child {
      padding-right: 0;
      border-right: none;
    }

    &_collapsed {
      flex: 0 0 auto;
      width: 44px;
      min-width: 0;
      padding: 0;
      gap: 0;
    }
  }

  &__column-collapsed {
    width: 100%;
    height: 100%;
    padding: 12px 0;
    gap: 10px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @include flex(cn, a-center);
    justify-content: flex-start;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__column-count {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @extend %text-s-medium;
  }

  &__column-collapsed-title {
    gap: 8px;
    writing-mode: vertical-rl;
    white-space: nowrap;
    color: var(--light-text-backgroung-primary);
    @include flex(rn, a-center);
    @extend %text-l-regular;

    i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-stage-color);
    }
  }

  &__column-heading {
    width: 100%;
    min-width: 0;
    min-height: 56px;
    padding: 0 4px;
    flex-shrink: 0;
    @include flex(cn);
    gap: 6px;

    &-main {
      min-width: 0;
      min-height: 28px;
      @include flex(rn, a-center);
      gap: 8px;

      > i {
        width: 8px;
        height: 8px;
        flex-shrink: 0;
        border-radius: 50%;
        background: var(--crm-stage-color);
      }
      strong {
        min-width: 0;
        overflow-wrap: anywhere;
        @extend %text-m-medium;
      }

      &-count {
        flex-shrink: 0;
        color: var(--light-text-backgroung-primary-50);
        font-variant-numeric: tabular-nums;
        @extend %text-m-regular;
      }

      button {
        margin-left: auto;
        width: 28px;
        height: 28px;
        padding: 4px;
        flex-shrink: 0;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--light-text-backgroung-primary-50);
        @include flex(center);
        &:hover {
          color: var(--light-text-backgroung-primary);
          background: var(--light-text-backgroung-primary-10);
        }
      }
    }
  }

  &__column-meta {
    min-width: 0;
    padding-left: 16px;
    color: var(--light-text-backgroung-primary-50);
    font-variant-numeric: tabular-nums;
    @include flex(rn, flex-end, a-center);
    gap: 8px;
    @extend %text-xs-regular;

    b {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: inherit;
      font-weight: 400;
    }
  }

  &__cards {
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
    gap: 10px;
    overflow-y: auto;
    overflow-x: hidden;
    @include flex(cn);
  }

  :deep(.base-kanban-card__header) {
    gap: 8px;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    b {
      flex-shrink: 0;
      color: inherit;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
  }

  :deep(.base-kanban-card__title) {
    overflow: visible;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }

  &__card-owner,
  &__next {
    min-width: 0;
    gap: 5px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);
    @extend %text-xs-regular;

    svg {
      flex-shrink: 0;
    }
  }
  &__next {
    width: 100%;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  &__next_overdue {
    color: var(--danger-delete);
  }
  &__next_empty {
    color: var(--status-in-progress);
  }

  &__empty {
    margin: 0;
    padding: 16px;
    color: var(--light-text-backgroung-primary-50);
  }
  &__error {
    color: var(--danger-delete);
  }

  &__directory {
    width: 100%;
    min-height: 0;
    overflow: hidden;
    @include flex(cn);
    gap: 12px;
  }

  &__directory-count {
    flex-shrink: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__table-wrap {
    width: 100%;
    min-height: 0;
    overflow: auto;
    max-height: 60vh;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    @extend %text-s-regular;

    th,
    td {
      padding: 8px 12px;
      text-align: left;
      white-space: nowrap;
      border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    }

    th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0;
      background: var(--dark-text-background-primary);
      @extend %text-s-medium;
    }

    tbody tr {
      transition: background 0.15s;

      &:hover {
        background: var(--light-text-backgroung-primary-5);
      }

      &:last-child td {
        border-bottom: none;
      }
    }

    td:nth-last-child(-n + 2) {
      font-variant-numeric: tabular-nums;
    }
  }

  &__sort-button {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    white-space: nowrap;
    @include flex(rn, a-center, j-start);
    gap: 6px;
    @extend %text-s-medium;

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      color: var(--light-text-backgroung-primary);
      box-shadow: inset 0 0 0 2px var(--primary);
      outline: none;
    }

    svg {
      flex-shrink: 0;
      opacity: 0.55;
    }

    &_active {
      color: var(--light-text-backgroung-primary);

      svg {
        color: var(--primary);
        opacity: 1;
      }
    }
  }

  &__directory-link {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    text-align: left;
    @extend %text-s-regular;

    &:hover {
      color: var(--primary-75);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }

  &__communication {
    span {
      display: block;
    }
  }

  &__panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 998;
    background: var(--dark-text-background-primary-50);
  }

  &__directory-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1098;
    background: var(--dark-text-background-primary-50);
    backdrop-filter: blur(2px);
  }

  &__panel {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 1000;
    width: min(1120px, calc(100vw - 80px));
    max-width: 100%;
    height: 100dvh;
    padding: 0;
    overflow-y: auto;
    background: var(--dark-text-background-primary);
    box-shadow: -16px 0 48px var(--black-50);
    @include flex(cn);
    gap: 0;

    &_expanded {
      width: calc(100vw - 80px);
    }

    &_directory {
      inset: 50% auto auto 50%;
      z-index: 1100;
      width: min(880px, calc(100vw - 48px));
      height: auto;
      max-height: calc(100dvh - 48px);
      border: 1px solid var(--light-text-backgroung-primary-25);
      border-radius: 12px;
      box-shadow: 0 24px 72px var(--black-50);
      transform: translate(-50%, -50%);

      > .crm__section:last-child {
        padding-bottom: 32px;
      }
    }
  }

  &__panel-header {
    position: sticky;
    top: 0;
    z-index: 5;
    min-height: 72px;
    flex-shrink: 0;
    padding: 16px 32px;
    gap: 8px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);
    @include flex(rn, a-center);

    &_deal {
      align-items: stretch;
      flex-direction: column;
      gap: 8px;
    }

    > span {
      margin-right: auto;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
    button {
      min-width: 40px;
      min-height: 40px;
      flex-shrink: 0;
      padding: 8px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      @include flex(center);
      &:hover {
        color: var(--light-text-backgroung-primary);
        background: var(--light-text-backgroung-primary-10);
      }
    }
  }

  &__panel-topbar {
    min-height: 44px;
    @include flex(rn, a-center, between);

    span {
      color: var(--light-text-backgroung-primary);
      @extend %text-l-medium;
    }
  }

  &__panel-close {
    width: 44px;
    height: 44px;
    padding: 0 !important;
  }

  &__panel-heading {
    min-width: 0;
  }

  &__panel-actions {
    min-height: 44px;
    margin-left: auto;
    @include flex(rn, a-center, j-end);
    gap: 12px;

    button {
      width: 44px;
      height: 44px;
      padding: 0;
    }
  }

  &__panel-title {
    min-width: 0;
    flex: 1;
    margin: 0 auto 0 0;
    overflow: visible;
    overflow-wrap: anywhere;
    color: var(--light-text-backgroung-primary);
    cursor: text;
    text-overflow: clip;
    white-space: normal;
    @extend %display-s-bold;
  }

  &__panel-delete {
    color: var(--danger-delete);

    &:hover:not(:disabled) {
      color: var(--danger-delete);
      background: var(--danger-delete-10);
    }
  }

  &__panel-title-form {
    min-width: 0;
    flex: 1;
    margin-right: auto;
    gap: 12px;
    @include flex(rn, a-start);

    textarea {
      width: 100%;
      min-width: 0;
      min-height: 48px;
      max-height: 144px;
      padding: 3px 6px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--light-text-backgroung-primary);
      overflow-x: hidden;
      overflow-y: auto;
      resize: none;
      @extend %display-s-bold;

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }

      &:focus-visible {
        outline: none;
        box-shadow: none;
      }
    }
  }

  &__panel-title-actions {
    min-height: 48px;
    flex-shrink: 0;
    @include flex(rn, a-center);
    gap: 4px;
  }

  &__panel-title-save {
    min-width: auto !important;
    padding: 8px !important;
    color: var(--light-text-backgroung-primary-50) !important;
    white-space: nowrap;
    @extend %text-s-regular;

    &:hover:not(:disabled),
    &:focus-visible {
      color: var(--light-text-backgroung-primary) !important;
      background: transparent !important;
    }
  }

  &__panel-title-cancel {
    min-width: 32px !important;
    min-height: 32px !important;
    padding: 4px !important;
    border-radius: 4px !important;
  }

  &__panel > .crm__error,
  &__panel > [role='alert'],
  &__panel > [role='status'] {
    margin: 20px 32px 0;
  }

  .loader__wrapper {
    width: 100%;
    height: 100%;
    @include flex(center);
  }

  &__deal-loss-reason {
    margin: 20px 32px 0;
    color: var(--danger-delete);
    @extend %text-s-regular;
  }

  &__deal-content {
    min-width: 0;
    padding: 24px 32px 40px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 24px;
    align-items: start;
  }

  &__deal-main {
    min-width: 0;
    @include flex(cn);
    gap: 0;
  }

  &__deal-meta {
    min-width: 0;
    padding: 0;
    gap: 0;
    @include flex(cn);

    > label,
    > .crm__deal-meta-field {
      gap: 4px;
      padding: 6px 0;
      border-bottom: 1px solid var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
      @include flex(cn);
      @extend %text-xs-medium;
    }

    input:not([type='checkbox']) {
      min-height: 36px;
      padding: 6px 0;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;

      &:focus-visible {
        outline: none;
        outline-offset: 0;
        box-shadow: none;
      }

      &[type='number'] {
        appearance: textfield;

        &::-webkit-inner-spin-button,
        &::-webkit-outer-spin-button {
          margin: 0;
          appearance: none;
        }
      }
    }

    :deep(.home-select__input_large) {
      min-height: 36px;
      padding: 6px 0;
      border: none;
      border-radius: 0;
      justify-content: flex-start;
      text-align: left;
    }

    :deep(.home-select),
    :deep(.home-select__placeholder),
    :deep(.base-dropdown),
    :deep(.base-dropdown__placeholder) {
      @extend %text-s-regular;
    }

    :deep(.home-select__placeholder),
    :deep(.base-dropdown__placeholder) {
      color: var(--light-text-backgroung-primary);
    }

    :deep(.base-dropdown) {
      width: 100%;
    }

    :deep(.base-dropdown__input) {
      width: 100%;
      min-height: 36px;
      color: var(--light-text-backgroung-primary);
      justify-content: flex-start;
      text-align: left;
      @include flex(rn, a-center);
    }

    :deep(.base-dropdown__dropdown) {
      top: 36px;
      right: 0;
      left: auto;
      width: 100%;
      min-width: max-content;
      max-width: min(360px, calc(100vw - 32px));
    }

    > .crm__primary {
      width: 100%;
      margin-top: 12px;
      justify-content: center;
    }
  }

  &__deal-company-control {
    width: 100%;
    min-width: 0;
    gap: 4px;
    @include flex(rn, a-center);

    :deep(.home-select) {
      min-width: 0;
      flex: 1;
    }
  }

  &__deal-company-open {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    padding: 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @include flex(center);

    &:hover:not(:disabled) {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: -2px;
    }
  }

  &__deal-contact-summary {
    min-width: 0;
    padding: 10px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    font-style: normal;
    gap: 6px;
    @include flex(cn);

    strong {
      min-width: 0;
      overflow: hidden;
      color: var(--light-text-backgroung-primary);
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
      @extend %text-s-medium;
    }

    a {
      min-width: 0;
      width: fit-content;
      max-width: 100%;
      color: var(--light-text-backgroung-primary-50);
      text-decoration: none;
      gap: 8px;
      @include flex(rn, a-center);
      @extend %text-s-regular;

      svg {
        flex: 0 0 16px;
      }

      span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover,
      &:focus-visible {
        color: var(--light-text-backgroung-primary);
      }

      &:focus-visible {
        border-radius: 4px;
        outline: 2px solid var(--primary-50);
        outline-offset: 2px;
      }
    }
  }

  &__deal-contact-empty {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__section-header {
    gap: 12px;
    @include flex(rn, between, a-center);

    h3 {
      margin: 0;
    }
  }

  &__next-action {
    margin: 0;
    gap: 8px;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);

    &_empty {
      color: var(--status-in-progress);
    }
  }

  &__inline-form {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 150px auto;
    gap: 12px;
    align-items: end;
    padding: 16px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;

    label {
      min-width: 0;
      gap: 6px;
      color: var(--light-text-backgroung-primary-50);
      @include flex(cn);
      @extend %text-xs-regular;
    }

    &-title {
      grid-column: 1 / -1;
    }

    > .crm__primary {
      min-height: 44px;
      justify-content: center;
    }

    :deep(.home-select__input_large) {
      min-height: 44px;
      background: transparent;
    }

    input[type='date'] {
      color-scheme: dark;

      &::-webkit-calendar-picker-indicator {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-left: 8px;
        padding: 2px;
        opacity: 0.85;
        filter: brightness(0) invert(1);
        cursor: pointer;
        transition: opacity 0.16s ease;
      }

      &:hover::-webkit-calendar-picker-indicator,
      &:focus-visible::-webkit-calendar-picker-indicator {
        opacity: 1;
      }
    }
  }

  &__link-task {
    margin-top: 20px;
    margin-bottom: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn);
    gap: 16px;

    &-trigger {
      width: fit-content;
      min-height: 32px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      cursor: pointer;
      @include flex(rn, a-center);
      gap: 4px;
      @extend %text-xs-regular;

      svg {
        stroke: currentColor;
      }

      &:hover,
      &:focus-visible {
        color: var(--light-text-backgroung-primary);
      }
    }

    &-editor {
      @include flex(rn, a-center);
      gap: 4px;
    }

    &-input {
      position: relative;
      z-index: 5;
      min-width: 0;
      flex: 1;

      input {
        width: 100%;
        min-height: 36px;
        padding: 8px 12px;
        border: 1px solid var(--light-text-backgroung-primary-10);
        border-radius: 8px;
        background: transparent;
        color: var(--light-text-backgroung-primary);
        outline: none;
        @extend %text-s-regular;

        &::placeholder {
          color: var(--light-text-backgroung-primary-50);
        }

        &:focus-visible {
          border-color: var(--light-text-backgroung-primary-25);
        }

        &::-webkit-search-cancel-button {
          display: none;
        }
      }
    }

    &-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      left: 0;
      z-index: 10;
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--dark-text-background-primary);
      box-shadow: 0 8px 24px var(--dark-text-background-primary-50);
      @include flex(cn);
    }

    &-result {
      width: 100%;
      min-height: 36px;
      padding: 8px 12px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
      @extend %text-s-regular;

      &:hover,
      &:focus-visible {
        background: var(--light-text-backgroung-primary-5);
        color: var(--light-text-backgroung-primary);
      }
    }

    &-state {
      min-height: 36px;
      padding: 8px 12px;
      color: var(--light-text-backgroung-primary-50);
      @include flex(rn, a-center);
      @extend %text-s-regular;
    }

    &-actions {
      flex-shrink: 0;
      @include flex(rn);
      gap: 4px;
    }
  }

  &__comments {
    padding-top: 32px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn);
    gap: 20px;
  }

  &__comments-header {
    @include flex(rn, between, a-center);

    > span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xl-medium;
    }
  }

  &__comments-tools {
    flex-shrink: 0;
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__comments-add {
    min-height: 32px;
    padding: 6px 10px;
    border: none;
    border-radius: 8px;
    background: var(--primary-10);
    color: var(--primary);
    @include flex(rn, a-center);
    gap: 6px;
    @extend %text-s-medium;

    &:hover,
    &:focus-visible {
      background: var(--primary-25);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__comments-sort {
    min-height: 32px;
    padding: 6px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 16px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);
    gap: 8px;
    @extend %text-s-regular;

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__comments-form {
    @include flex(rn, a-start);
    gap: 24px;
  }

  &__comments-input {
    min-width: 0;
    flex: 1;
    padding: 16px 16px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    @include flex(cn);
    gap: 12px;
    @extend %p14-medium;

    > .crm__primary {
      width: fit-content;
      margin-left: auto;
    }
  }

  &__comments-body {
    min-height: 40px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(cn);
    gap: 12px;
    @extend %p14-medium;

    &_timeline {
      gap: 8px;
    }
  }

  &__comments-event {
    position: relative;
    min-width: 0;

    &:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 14px;
      bottom: -22px;
      width: 1px;
      background: var(--light-text-backgroung-primary-10);
      pointer-events: none;
    }

    &_comment {
      padding-left: 28px;

      &::after {
        content: '';
        position: absolute;
        left: 4px;
        top: 10px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--light-text-backgroung-primary-50);
        box-shadow: 0 0 0 4px var(--dark-text-background-primary);
      }
    }
  }

  &__timeline-comment {
    min-width: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    @include flex(rn);
    gap: 8px;
  }

  &__timeline-avatar {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    @extend %text-xs-regular;
  }

  &__timeline-comment-content {
    min-width: 0;
    flex: 1;
    color: var(--light-text-backgroung-primary);
    @include flex(cn);
    gap: 4px;
    @extend %p14-medium;

    header {
      min-width: 0;
      color: var(--light-text-backgroung-primary-50);
      @include flex(rw, a-center);
      gap: 4px 8px;
      @extend %text-s-regular;

      time {
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }

  &__timeline-activity {
    padding: 4px 0;
    color: var(--light-text-backgroung-primary);
    @include flex(rn, a-start);
    gap: 12px;
    @extend %text-s-regular;
  }

  &__timeline-activity-icon {
    position: relative;
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--light-text-backgroung-primary-50);
    background: var(--dark-text-background-primary);
    box-shadow: 0 0 0 3px var(--dark-text-background-primary);
  }

  &__timeline-activity-content {
    min-width: 0;
    overflow-wrap: anywhere;
    @include flex(cn);
    gap: 2px;

    header {
      @include flex(rw, a-center);
      gap: 4px 12px;

      strong {
        @extend %text-s-medium;
      }

      time {
        color: var(--light-text-backgroung-primary-50);
        @extend %text-xs-regular;
      }
    }
  }

  &__form {
    width: 100%;
    max-width: 760px;
    padding: 28px 32px 0;
    gap: 24px;
    @include flex(cn);
  }
  &__form > h2 {
    margin-bottom: 0;
  }
  &__form > .crm__primary {
    min-width: 160px;
    align-self: flex-start;
    justify-content: center;
  }
  &__form label,
  &__meta-field {
    gap: 6px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(cn);
    @extend %text-xs-regular;
  }
  &__required {
    margin-left: 4px;
    color: var(--accent);
  }
  &__field-hint {
    color: var(--light-text-backgroung-primary-50);
    line-height: 1.45;
    @extend %text-xs-regular;
  }
  &__form-empty {
    margin: -12px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
  &__form input,
  &__form textarea {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }
  &__fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  &__field_full {
    grid-column: 1 / -1;
  }
  &__actions {
    flex-wrap: wrap;
  }
  &__actions button:not(.crm__primary),
  &__form > button:not(.crm__primary),
  &__section button:not(.crm__primary) {
    min-height: 36px;
    padding: 7px 10px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__form :deep(.home-select__input_large) {
    min-height: 44px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    justify-content: flex-start;
    text-align: left;
  }
  &__form :deep(.home-select__dropdown) {
    background: var(--dark-text-background-primary);
  }

  fieldset {
    margin: 0;
    padding: 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    max-height: 240px;
    overflow: auto;
  }
  legend {
    padding: 0 6px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__task {
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, between, a-center);

    &:last-child {
      border-bottom: none;
    }
  }
  &__contact label {
    min-width: 0;
    gap: 8px;
    min-height: 44px;
    @include flex(rn, a-center);
  }
  &__task > button:first-child {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    flex: 1;
    min-width: 0;
    gap: 2px;
    text-align: left;
    white-space: normal;

    small {
      width: 100%;
      text-align: left;
    }
  }
  &__check {
    flex-shrink: 0;
    gap: 8px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);
    @extend %text-xs-regular;
  }

  &__section {
    margin: 0 32px;
    padding: 24px 0 0;
    border-top: 1px solid var(--light-text-backgroung-primary-10);

    &_inner {
      margin: 0;
      padding-top: 32px;
    }

    &_tasks {
      margin: 0;
      padding-top: 0;
      border-top: none;
    }
  }
  &__section h3 {
    margin-bottom: 12px;
  }
  &__dialog {
    width: min(480px, calc(100vw - 32px));
    margin: auto;
    padding: 24px;
    color: var(--light-text-backgroung-primary);
    border: 1px solid var(--light-text-backgroung-primary-25);
    border-radius: 12px;
    background: var(--dark-text-background-primary);
    &::backdrop {
      background: var(--black-50);
    }
    form {
      gap: 20px;
      @include flex(cn);
    }
    h2 {
      margin: 0;
    }
    label {
      gap: 6px;
      color: var(--light-text-backgroung-primary-50);
      @include flex(cn);
      @extend %text-xs-regular;
    }
    input:not([type='checkbox']) {
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      outline: none;
      transition: border-color 0.16s ease;
      @extend %text-s-regular;

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }

      &:focus,
      &:focus-visible {
        border-color: var(--primary-50);
        outline: none;
        box-shadow: none;
      }
    }
    :deep(.home-select__input_large) {
      min-height: 44px;
      padding: 10px 12px;
      border-color: var(--light-text-backgroung-primary-10);
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      transition: border-color 0.16s ease;
    }
    :deep(.home-select__input_large:focus-visible) {
      border-color: var(--primary-50);
      outline: none;
      box-shadow: none;
    }
    :deep(.home-select__placeholder) {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;
    }
    .crm__actions {
      justify-content: flex-end;
      margin-top: 4px;
    }
  }

  @media (max-width: $screen-tablet) {
    &__filters {
      width: 100%;
    }
    &__panel,
    &__panel_expanded {
      width: 100%;
      padding: 0 0 calc(88px + env(safe-area-inset-bottom));
    }
    &__panel_directory {
      inset: 50% auto auto 50%;
      width: min(720px, calc(100vw - 32px));
      height: auto;
      max-height: calc(100dvh - 32px);
      padding: 0;
      transform: translate(-50%, -50%);
    }
    &__fields {
      grid-template-columns: minmax(0, 1fr);
    }
    &__deal-content {
      grid-template-columns: minmax(0, 1fr);
    }
    &__deal-meta {
      order: -1;
      padding: 20px;
      border-left: none;
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
    }
    &__inline-form {
      grid-template-columns: minmax(0, 1fr);

      &-title {
        grid-column: auto;
      }
    }
  }

  @media (max-width: $screen-mobile-l) {
    height: 100%;
    padding: 12px var(--mobile-page-gutter);
    gap: 12px;
    &__header {
      align-items: center;
    }
    &__primary {
      min-height: 44px;
    }
    &__tabs {
      flex-shrink: 0;
    }
    &__comments-sort {
      min-height: 44px;
    }
    &__comments-add {
      min-height: 44px;
    }
    &__comments-event_comment {
      padding-left: 20px;
    }
    &__column {
      flex-basis: calc(100vw - 48px);
      width: calc(100vw - 48px);
      min-width: calc(100vw - 48px);
      max-width: calc(100vw - 48px);
    }
    &__column_collapsed {
      flex-basis: 44px;
      width: 44px;
      min-width: 44px;
    }
    &__panel-header,
    &__form,
    &__deal-content {
      padding-left: 16px;
      padding-right: 16px;
    }
    &__panel-header {
      min-height: 64px;
      padding-top: 12px;
      padding-bottom: 12px;
    }
    &__panel-actions > .crm__panel-expand {
      display: none;
    }
    &__panel_directory {
      width: calc(100vw - 24px);
      max-height: calc(100dvh - 24px);
    }
    &__deal-loss-reason {
      margin-right: 16px;
      margin-left: 16px;
    }
    &__deal-content {
      padding-top: 20px;
      padding-bottom: 32px;
      gap: 24px;
    }
    &__comments {
      padding-top: 24px;
    }
    &__comments-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 12px;
    }
    &__comments-tools {
      width: 100%;
      min-width: 0;
      flex-wrap: wrap;
    }
    &__section-header {
      align-items: flex-start;
      flex-direction: column;
    }
    &__fields {
      grid-template-columns: minmax(0, 1fr);
    }
    &__field_full {
      grid-column: auto;
    }
    &__form > .crm__primary {
      width: 100%;
      align-self: stretch;
    }
    &__section {
      margin-left: 16px;
      margin-right: 16px;
    }
    input:not([type='checkbox']),
    select,
    textarea {
      font-size: 16px;
    }
  }
}

.crm-delete-confirm {
  padding: 0 24px;
  @include flex(cn);
  gap: 16px;

  h2,
  p {
    margin: 0;
  }

  h2 {
    @extend %display-xs-medium;
  }

  p {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__error {
    color: var(--danger-delete) !important;
  }

  &__actions {
    @include flex(rn, flex-end, a-center);
    gap: 8px;
  }

  &__submit {
    border-color: var(--danger-delete);
    background: var(--danger-delete);
    color: var(--light-text-backgroung-primary);
  }

  @media (max-width: $screen-mobile-l) {
    padding: 0 16px;

    &__actions {
      align-items: stretch;
      flex-direction: column-reverse;
    }
  }
}
</style>
