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
  type JsonObject,
} from '@tracker/contracts';
import type { JSONContent } from '@tiptap/core';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import { CrmSection, CrmPanel, CrmProjectChoice } from '~/enums/crm.enums';
import type { Task } from '~/types/task';

const props = defineProps<{ section: CrmSection }>();
useHead({ title: 'CRM' });
const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const baseURL = useApiBaseUrl();
const headers = useRequestHeaders(['cookie']);
const request = { baseURL, headers, credentials: 'include' as const };
const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const search = ref('');
const companyFilter = ref('');
const ownerFilter = ref('');
const sourceFilter = ref('');
const quick = ref(CrmQuickFilter.ALL);
const collapsed = ref<number[]>([7, 8]);
const dragging = ref<number | null>(null);
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
const {
  data: board,
  error: boardError,
  pending,
  refresh: refreshBoard,
} = await useAsyncData(`crm-board-${props.section}`, () =>
  props.section === CrmSection.DEALS ? $fetch<CrmColumn[]>('/api/crm/board', { ...request, query: query.value }) : Promise.resolve([]),
);
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
const companyName = (id: number | null) => options.value?.companies.find((c) => c.id === id)?.name ?? 'Без компании';
const ownerName = (id: number | null) => options.value?.users.find((u) => u.id === id)?.name ?? 'Не назначен';
const stats = (id: number) => options.value?.company_stats[id] ?? { count: 0, amount: '0' };
const companies = computed(() =>
  (options.value?.companies ?? []).filter((c) => c.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())),
);
const contacts = computed(() =>
  (options.value?.contacts ?? []).filter(
    (c) =>
      c.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()) &&
      (!companyFilter.value || c.company_id === Number(companyFilter.value)),
  ),
);
const panelId = computed(() => Number(route.query.deal || 0));
const {
  data: deal,
  error: dealError,
  refresh: refreshDeal,
} = await useAsyncData(
  'crm-deal',
  () => (panelId.value ? $fetch<CrmDealDetail>(`/api/crm/deals/${panelId.value}`, request) : Promise.resolve(null)),
  { watch: [panelId] },
);
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
const expanded = ref(false);
const returnToDeal = ref(false);
const savedScroll = ref(0);
const companyForm = ref<CrmCompany>({ id: 0, name: '', legal_name: '', inn: '', website: '', notes: '', responsible_id: null });
const contactForm = ref<CrmContact>({ id: 0, name: '', company_id: null, position: '', phone: '', email: '', telegram: '' });
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
const description = ref<JSONContent>(emptyDoc());
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
const timelineFilter = ref('all');
const timeline = computed(
  () => deal.value?.activities.filter((a) => timelineFilter.value === 'all' || a.kind === timelineFilter.value) ?? [],
);
const taskTitle = ref('');
const taskDate = ref('');
const taskOwner = ref<number | null>(null);
const taskSearch = ref('');
const taskResults = ref<Task[]>([]);
const showCompleted = ref(false);
const tasks = computed(() => deal.value?.tasks.filter((t) => showCompleted.value || t.status !== 'closed') ?? []);
const newTitle = ref('');
const newDealDialog = ref<HTMLDialogElement>();
const stageDialog = ref<HTMLDialogElement>();
const stageChange = ref<{ id: number; stage: number; kind: CrmStageKind } | null>(null);
const reason = ref('');
const projectChoice = ref(CrmProjectChoice.NONE);
const selectedProject = ref<number | null>(null);
const relatedDeals = ref<CrmDeal[]>([]);
const copyLink = () =>
  run(async () => {
    await navigator.clipboard.writeText(window.location.href);
  });

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
  returnToDeal.value = false;
  panel.value = CrmPanel.DEAL;
  await router.push({ query: { ...route.query, deal: id } });
};
const closePanel = async () => {
  if (returnToDeal.value) {
    panel.value = CrmPanel.DEAL;
    returnToDeal.value = false;
    await nextTick();
    if (panelElement.value) panelElement.value.scrollTop = savedScroll.value;
    return;
  }
  panel.value = null;
  const { deal: _deal, ...rest } = route.query;
  await router.replace({ query: rest });
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
      company_id: fromDeal ? draft.company_id : null,
      position: '',
      phone: '',
      email: '',
      telegram: '',
      ...options.value?.contacts.find((c) => c.id === id),
    };
  panel.value = kind;
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
  await run(async () => {
    const form = panel.value === CrmPanel.COMPANY ? companyForm.value : contactForm.value;
    const { id, ...body } = form;
    const path = panel.value === CrmPanel.COMPANY ? CrmSection.COMPANIES : CrmSection.CONTACTS;
    const result = await $fetch<CrmCompany | CrmContact>(`/api/crm/${path}${id ? `/${id}` : ''}`, {
      ...request,
      method: id ? 'PATCH' : 'POST',
      body,
    });
    await refreshOptions();
    if (returnToDeal.value && !id) {
      if (panel.value === CrmPanel.COMPANY) draft.company_id = result.id;
      else {
        draft.contact_ids.push(result.id);
        draft.primary_contact_id ??= result.id;
      }
    }
    if (panel.value === CrmPanel.COMPANY) companyForm.value = result as CrmCompany;
    else contactForm.value = result as CrmContact;
    if (returnToDeal.value) await closePanel();
  });
};
const createDeal = async () => {
  await run(async () => {
    const created = await $fetch<CrmDealDetail>('/api/crm/deals', {
      ...request,
      method: 'POST',
      body: { title: newTitle.value },
    });
    newTitle.value = '';
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
    description: description.value as JsonObject,
  };
};
const saveDeal = async () => {
  await run(async () => {
    await $fetch(`/api/crm/deals/${panelId.value}`, { ...request, method: 'PATCH', body: dealBody() });
    savedFields = JSON.stringify(dealBody());
    await refreshAll();
  });
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
      ...request, method: 'PATCH', body: { ...(panelId.value === id ? dealBody() : {}), stage_id: stageId },
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
    taskTitle.value = '';
    taskDate.value = '';
    await refreshAll();
  });
};
const searchTasks = async () => {
  await run(async () => {
    taskResults.value = await taskStore.searchTasks(taskSearch.value);
  });
};
const linkTask = async (id: number) => {
  await run(async () => {
    await $fetch(`/api/crm/deals/${panelId.value}/task-links`, { ...request, method: 'POST', body: { task_id: id } });
    taskResults.value = [];
    taskSearch.value = '';
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
const toggleContact = (id: number, checked: boolean) => {
  draft.contact_ids = checked ? [...draft.contact_ids, id] : draft.contact_ids.filter((c) => c !== id);
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
      description.value = value.description ?? emptyDoc();
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
const stageSelected = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const stage = Number(select.value);
  select.value = String(deal.value?.stage_id ?? 1);
  void changeStage(panelId.value, stage);
};
</script>

<template>
  <main class="crm">
    <header class="crm__header">
      <h1>CRM</h1>
      <button
        class="crm__primary"
        @click="section === CrmSection.DEALS ? newDealDialog?.showModal() : openDirectory(section === CrmSection.COMPANIES ? CrmPanel.COMPANY : CrmPanel.CONTACT)"
      >
        {{ section === CrmSection.DEALS ? 'Новая сделка' : section === CrmSection.COMPANIES ? 'Добавить компанию' : 'Добавить контакт' }}
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
    <div class="crm__filters">
      <label>Поиск<input v-model="search" type="search" placeholder="Название или имя" /></label>
      <label v-if="section !== CrmSection.COMPANIES"
        >Компания<select v-model="companyFilter">
          <option value="">Все компании</option>
          <option v-for="c in options?.companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select></label
      >
      <template v-if="section === CrmSection.DEALS"
        ><label
          >Ответственный<select v-model="ownerFilter">
            <option value="">Все</option>
            <option v-for="u in options?.users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select></label
        ><label
          >Источник<select v-model="sourceFilter">
            <option value="">Все</option>
            <option v-for="s in options?.sources" :key="s">{{ s }}</option>
          </select></label
        ></template
      >
    </div>
    <div v-if="section === CrmSection.DEALS" class="crm__quick">
      <button
        v-for="f in [
          { value: CrmQuickFilter.ALL, label: 'Все сделки' },
          { value: CrmQuickFilter.MINE, label: 'Мои' },
          { value: CrmQuickFilter.OVERDUE, label: 'Просроченные действия' },
          { value: CrmQuickFilter.UNSCHEDULED, label: 'Без следующего шага' },
        ]"
        :key="f.value"
        :aria-pressed="quick === f.value"
        @click="quick = f.value"
      >
        {{ f.label }}</button
      ><span v-if="pending" role="status">Обновление…</span>
    </div>
    <div v-if="optionsError || boardError" role="alert" class="crm__error">
      Не удалось загрузить CRM. <button @click="refreshAll">Повторить</button>
    </div>
    <p v-if="error" role="alert" class="crm__error">{{ error }}</p>
    <div v-if="section === CrmSection.DEALS" class="crm__board" aria-label="Воронка сделок">
      <section
        v-for="column in board"
        :key="column.stage.id"
        class="crm__column"
        :class="{ crm__column_collapsed: collapsed.includes(column.stage.id) }"
        @dragover.prevent
        @drop.prevent="
          dragging && changeStage(dragging, column.stage.id);
          dragging = null;
        "
      >
        <button
          class="crm__column-heading"
          :aria-expanded="!collapsed.includes(column.stage.id)"
          @click="
            collapsed = collapsed.includes(column.stage.id)
              ? collapsed.filter((id) => id !== column.stage.id)
              : [...collapsed, column.stage.id]
          "
        >
          <strong>{{ column.stage.name }}</strong
          ><span>{{ column.total }} · {{ money(column.amount) }}</span>
        </button>
        <div v-if="!collapsed.includes(column.stage.id)" class="crm__cards">
          <button
            v-for="card in column.cards"
            :key="card.id"
            class="crm__card"
            draggable="true"
            @dragstart="dragging = card.id"
            @dragend="dragging = null"
            @click="openDeal(card.id)"
          >
            <strong>{{ card.title }}</strong
            ><span>{{ card.company_name || 'Без компании' }}</span
            ><b>{{ money(card.amount) }}</b
            ><span>{{ card.responsible_name || 'Не назначен' }}</span
            ><span
              v-if="card.next_task"
              class="crm__next"
              :class="{ crm__next_overdue: card.next_task.planned_date && card.next_task.planned_date < today() }"
              >{{ card.next_task.planned_date && card.next_task.planned_date < today() ? 'Просрочено · ' : ''
              }}{{ card.next_task.planned_date }}<br />{{ card.next_task.title }}</span
            ><span v-else-if="column.stage.kind === CrmStageKind.OPEN" class="crm__next">Следующий шаг не запланирован</span>
          </button>
          <p v-if="!column.total" class="crm__empty">Сделок пока нет</p>
          <button v-if="column.has_more" :disabled="busy" @click="loadMore(column)">Показать ещё</button>
        </div>
      </section>
    </div>
    <div v-else class="crm__directory">
      <table v-if="section === CrmSection.COMPANIES">
        <thead>
          <tr>
            <th>Компания</th>
            <th>Сайт</th>
            <th>Ответственный</th>
            <th>Открытые сделки</th>
            <th>Сумма в работе</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in companies" :key="c.id">
            <td>
              <button @click="openDirectory(CrmPanel.COMPANY, c.id)">{{ c.name }}</button>
            </td>
            <td>{{ c.website || 'Не указан' }}</td>
            <td>{{ ownerName(c.responsible_id) }}</td>
            <td>{{ stats(c.id).count }}</td>
            <td>{{ money(stats(c.id).amount) }}</td>
          </tr>
        </tbody>
      </table>
      <table v-else>
        <thead>
          <tr>
            <th>Контакт</th>
            <th>Компания</th>
            <th>Должность</th>
            <th>Телефон / Email</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in contacts" :key="c.id">
            <td>
              <button @click="openDirectory(CrmPanel.CONTACT, c.id)">{{ c.name }}</button>
            </td>
            <td>{{ companyName(c.company_id) }}</td>
            <td>{{ c.position }}</td>
            <td>{{ c.phone }}<br />{{ c.email }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!(section === CrmSection.COMPANIES ? companies.length : contacts.length)" class="crm__empty">
        Ничего не найдено. Измените поиск или добавьте запись.
      </p>
    </div>

    <aside
      v-if="panel"
      v-show="!taskStore.currentTaskId"
      ref="panelElement"
      class="crm__panel"
      :class="{ crm__panel_expanded: expanded }"
      aria-label="Карточка CRM"
      @keydown.esc="closePanel"
    >
      <header class="crm__panel-header">
        <button @click="closePanel">{{ returnToDeal ? 'Назад к сделке' : 'Закрыть' }}</button
        ><button @click="expanded = !expanded">{{ expanded ? 'Свернуть' : 'Расширить' }}</button
        ><button v-if="panel === CrmPanel.DEAL" @click="copyLink">Копировать ссылку</button>
      </header>
      <p v-if="error" class="crm__error" role="alert">{{ error }}</p>
      <template v-if="panel === CrmPanel.DEAL">
        <p v-if="dealError" role="alert">Не удалось открыть сделку. <button @click="refreshDeal()">Повторить</button></p>
        <template v-else-if="deal">
          <h2>{{ deal.title }}</h2>
          <p v-if="deal.loss_reason">Причина проигрыша: {{ deal.loss_reason }}</p>
          <label
            >Этап<select :value="deal.stage_id" :disabled="busy" @change="stageSelected">
              <option v-for="s in options?.stages" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select></label
          >
          <form id="crm-deal-fields" class="crm__form" @submit.prevent="saveDeal">
            <label>Название<input v-model="draft.title" required maxlength="200" /></label>
            <div class="crm__fields">
              <label
                >Сумма, ₽<input
                  v-model.number="draft.amount"
                  type="number"
                  min="0"
                  max="9999999999.99"
                  step="0.01"
                  placeholder="Не указана" /></label
              ><label
                >Ответственный<select v-model="draft.responsible_id">
                  <option :value="null">Не назначен</option>
                  <option v-for="u in options?.users" :key="u.id" :value="u.id">{{ u.name }}</option>
                </select></label
              >
            </div>
            <label
              >Компания<select v-model="draft.company_id">
                <option :value="null">Без компании</option>
                <option v-for="c in options?.companies" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select></label
            >
            <div class="crm__actions">
              <button type="button" @click="openDirectory(CrmPanel.COMPANY, 0, true)">Добавить компанию</button
              ><button v-if="draft.company_id" type="button" @click="openDirectory(CrmPanel.COMPANY, draft.company_id, true)">
                Открыть компанию
              </button>
            </div>
            <fieldset>
              <legend>Контакты сделки</legend>
              <div v-for="c in options?.contacts" :key="c.id" class="crm__contact">
                <label
                  ><input
                    type="checkbox"
                    :checked="draft.contact_ids.includes(c.id)"
                    @change="toggleContact(c.id, ($event.target as HTMLInputElement).checked)"
                  />{{ c.name }} · {{ companyName(c.company_id) }}</label
                ><button type="button" @click="openDirectory(CrmPanel.CONTACT, c.id, true)">Открыть</button>
              </div>
              <button type="button" @click="openDirectory(CrmPanel.CONTACT, 0, true)">Добавить контакт</button>
            </fieldset>
            <label
              >Основной контакт<select v-model="draft.primary_contact_id">
                <option :value="null">Не выбран</option>
                <option v-for="c in options?.contacts.filter((c) => draft.contact_ids.includes(c.id))" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select></label
            >
            <div class="crm__fields">
              <label
                >Источник<input v-model="draft.source" list="crm-sources" maxlength="200" /><datalist id="crm-sources">
                  <option v-for="s in options?.sources" :key="s" :value="s" /></datalist></label
              ><label>Ожидаемая дата закрытия<input v-model="draft.expected_close" type="date" /></label>
            </div>
            <label
              >Проект<select v-model="draft.project_id">
                <option :value="null">Без проекта</option>
                <option v-for="p in options?.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select></label
            >
          </form>
          <div class="crm__form">
            <label>Описание</label
            ><EditorTiptap
              :key="`description-${deal.id}`"
              v-model="description"
              :value="description"
              :is-editable="true"
              :file-prefix="`crm/deals/${deal.id}/`"
            />
            <button form="crm-deal-fields" class="crm__primary" :disabled="busy">{{ busy ? 'Сохранение…' : 'Сохранить изменения' }}</button>
          </div>
          <section class="crm__section">
            <h3>Задачи по сделке</h3>
            <p v-if="deal.next_task">Следующее действие: {{ deal.next_task.title }} · {{ deal.next_task.planned_date }}</p>
            <p v-else>Следующий шаг не запланирован</p>
            <div v-for="t in tasks" :key="t.id" class="crm__task">
              <button @click="openTask(t.id)">
                {{ t.title
                }}<small
                  >{{ t.planned_date || 'Без даты' }} ·
                  {{ t.status === 'closed' ? 'Закрыта' : t.status === 'in_progress' ? 'Выполняется' : 'К выполнению' }}</small
                ></button
              ><button v-if="t.status !== 'closed'" :disabled="busy" @click="completeTask(t.id)">Завершить</button>
            </div>
            <label class="crm__check"><input v-model="showCompleted" type="checkbox" />Показать завершённые</label>
            <form class="crm__form" @submit.prevent="createTask">
              <label
                >Новая задача<input
                  v-model="taskTitle"
                  required
                  minlength="3"
                  maxlength="150"
                  placeholder="Например, уточнить решение по КП"
              /></label>
              <div class="crm__fields">
                <label>Срок<input v-model="taskDate" type="date" /></label
                ><label
                  >Ответственный<select v-model="taskOwner">
                    <option :value="null">Я</option>
                    <option v-for="u in options?.users" :key="u.id" :value="u.id">{{ u.name }}</option>
                  </select></label
                >
              </div>
              <button :disabled="busy">Добавить задачу</button>
            </form>
            <details>
              <summary>Привязать существующую задачу</summary>
              <form @submit.prevent="searchTasks">
                <label>Поиск задачи<input v-model="taskSearch" required /></label><button :disabled="busy">Найти</button>
              </form>
              <button v-for="t in taskResults" :key="t.id" :disabled="busy" @click="linkTask(t.id)">
                {{ t.title }} · Привязать
              </button>
            </details>
          </section>
          <section class="crm__section">
            <h3>Комментарии и активность</h3>
            <label
              >Показывать<select v-model="timelineFilter">
                <option value="all">Всё</option>
                <option :value="CrmActivityKind.COMMENT">Комментарии</option>
                <option :value="CrmActivityKind.CHANGE">Активности</option>
              </select></label
            >
            <article v-for="a in timeline" :key="a.id" class="crm__activity">
              <small>{{ a.author_name }} · {{ new Date(a.created_at).toLocaleString('ru-RU') }}</small
              ><EditorTiptap v-if="a.message" :value="a.message" :model-value="a.message" :is-editable="false" />
              <p v-else>{{ a.summary }}</p>
            </article>
            <div>
              <label>Комментарий</label
              ><EditorTiptap
                :key="`comment-${deal.id}`"
                ref="commentEditor"
                v-model="comment"
                :value="comment"
                :is-editable="true"
                :file-prefix="`crm/deals/${deal.id}/`"
              /><button :disabled="busy" @click="sendComment">Отправить</button>
            </div>
          </section>
        </template>
        <p v-else role="status">Загрузка сделки…</p>
      </template>
      <form v-else-if="panel === CrmPanel.COMPANY" class="crm__form" @submit.prevent="saveDirectory">
        <h2>{{ companyForm.id ? companyForm.name : 'Новая компания' }}</h2>
        <label>Название<input v-model="companyForm.name" required maxlength="200" /></label
        ><label>Юридическое название<input v-model="companyForm.legal_name" /></label
        ><label>ИНН<input v-model="companyForm.inn" maxlength="20" /></label
        ><label>Сайт<input v-model="companyForm.website" /></label
        ><label
          >Ответственный<select v-model="companyForm.responsible_id">
            <option :value="null">Не назначен</option>
            <option v-for="u in options?.users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select></label
        ><label>Примечания<textarea v-model="companyForm.notes" rows="4" /></label
        ><button class="crm__primary" :disabled="busy">Сохранить</button>
        <h3>Контакты</h3>
        <button
          v-for="c in options?.contacts.filter((c) => c.company_id === companyForm.id)"
          :key="c.id"
          type="button"
          @click="openDirectory(CrmPanel.CONTACT, c.id, returnToDeal)"
        >
          {{ c.name }} · {{ c.position }}
        </button>
      </form>
      <form v-else class="crm__form" @submit.prevent="saveDirectory">
        <h2>{{ contactForm.id ? contactForm.name : 'Новый контакт' }}</h2>
        <label>Имя<input v-model="contactForm.name" required maxlength="200" /></label
        ><label
          >Компания<select v-model="contactForm.company_id">
            <option :value="null">Без компании</option>
            <option v-for="c in options?.companies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select></label
        ><label>Должность<input v-model="contactForm.position" /></label
        ><label>Телефон<input v-model="contactForm.phone" type="tel" /></label
        ><label>Email<input v-model="contactForm.email" type="email" /></label
        ><label>Telegram<input v-model="contactForm.telegram" /></label
        ><button class="crm__primary" :disabled="busy">Сохранить</button>
      </form>
      <section v-if="panel !== CrmPanel.DEAL" class="crm__section">
        <h3>Сделки и проекты</h3>
        <p v-if="!relatedDeals.length">Связанных сделок пока нет</p>
        <div v-for="d in relatedDeals" :key="d.id">
          <button @click="openDeal(d.id)">{{ d.title }} · {{ money(d.amount) }}</button>
          <p v-if="d.project_id">Проект: {{ options?.projects.find((p) => p.id === d.project_id)?.name }}</p>
        </div>
      </section>
    </aside>
    <dialog ref="newDealDialog" class="crm__dialog">
      <form @submit.prevent="createDeal">
        <h2>Новая сделка</h2>
        <label>Название<input v-model="newTitle" required maxlength="200" autofocus /></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="crm__actions">
          <button type="button" @click="newDealDialog?.close()">Отмена</button
          ><button class="crm__primary" :disabled="busy">Создать</button>
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
  @include flex(cn);
  gap: 16px;
  overflow: hidden;
  color: var(--light-text-backgroung-primary);
  @extend %text-s-regular;
  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }
  h2 {
    margin: 16px 0;
    @extend %h1;
    overflow-wrap: anywhere;
  }
  h3 {
    margin: 0 0 12px;
    @extend %text-m-medium;
  }
  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
    padding: 10px 12px;
    min-height: 44px;
    min-width: 0;
  }
  button {
    cursor: pointer;
    text-align: left;
    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
  :is(button, input, select, textarea, a):focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  option {
    background: var(--dark-text-background-primary);
  }
  label {
    @include flex(cn);
    gap: 6px;
    min-width: 0;
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    min-height: 18px;
    padding: 0;
    flex: 0 0 18px;
    accent-color: var(--primary);
  }
  small {
    display: block;
    color: var(--light-text-backgroung-primary-50);
  }
  fieldset {
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    max-height: 240px;
    overflow: auto;
  }
  &__header,
  &__actions,
  &__quick,
  &__tabs {
    @include flex(rw, a-center);
    gap: 8px;
  }
  &__header {
    justify-content: space-between;
  }
  &__primary {
    background: var(--primary) !important;
    color: var(--light-text-backgroung-primary);
  }
  &__tabs {
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    a {
      padding: 12px 16px;
      color: inherit;
      text-decoration: none;
      border-bottom: 2px solid transparent;
      &[aria-current='page'] {
        border-color: var(--primary);
      }
    }
  }
  &__filters {
    @include flex(rw);
    gap: 12px;
    label {
      flex: 1;
      max-width: 280px;
    }
  }
  &__quick {
    button[aria-pressed='true'] {
      border-color: var(--primary);
    }
  }
  &__board {
    @include flex(rn);
    gap: 12px;
    overflow-x: auto;
    min-height: 0;
    flex: 1;
    align-items: stretch;
    padding-bottom: 8px;
  }
  &__column {
    flex: 0 0 288px;
    min-width: 0;
    @include flex(cn);
    background: var(--light-text-backgroung-primary-5);
    border-radius: 12px;
    overflow: hidden;
    &_collapsed {
      flex-basis: 64px;
      .crm__column-heading {
        writing-mode: vertical-rl;
        height: 100%;
        align-items: start;
        justify-content: start;
      }
    }
  }
  &__column-heading {
    @include flex(cn, stretch);
    text-align: left;
    gap: 8px;
    border: 0 !important;
    padding: 16px !important;
    border-radius: 0 !important;
    span {
      @extend %p12-regular;
      color: var(--light-text-backgroung-primary-50);
      font-variant-numeric: tabular-nums;
    }
  }
  &__cards {
    @include flex(cn);
    gap: 8px;
    padding: 8px;
    overflow-y: auto;
    min-height: 0;
  }
  &__card {
    @include flex(cn, stretch);
    text-align: left;
    gap: 8px;
    flex-shrink: 0;
    width: 100%;
    padding: 16px !important;
    overflow-wrap: anywhere;
    strong {
      @extend %text-s-medium;
    }
    b {
      font-variant-numeric: tabular-nums;
    }
    > span {
      @extend %p12-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }
  &__next {
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    padding-top: 8px;
    &_overdue {
      color: var(--danger-delete) !important;
    }
  }
  &__empty {
    padding: 16px;
    color: var(--light-text-backgroung-primary-50);
  }
  &__error {
    color: var(--danger-delete);
  }
  &__directory {
    overflow: auto;
    min-height: 0;
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      position: sticky;
      top: 0;
      background: var(--dark-text-background-primary);
    }
    th,
    td {
      padding: 12px;
      border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    }
  }
  &__panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(720px, calc(100vw - 80px));
    z-index: 1000;
    overflow-y: auto;
    padding: 16px 24px 32px;
    background: var(--dark-text-background-primary);
    border-left: 1px solid var(--light-text-backgroung-primary-25);
    box-shadow: -16px 0 48px var(--black-50);
    &_expanded {
      width: calc(100vw - 80px);
    }
  }
  &__panel-header {
    @include flex(rw, between, a-center);
    gap: 8px;
    position: sticky;
    top: -16px;
    z-index: 2;
    background: var(--dark-text-background-primary);
    padding: 12px 0;
  }
  &__form {
    @include flex(cn);
    gap: 16px;
    margin-top: 16px;
  }
  &__fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  &__contact,
  &__task {
    @include flex(rn, between, a-center);
    gap: 8px;
    padding: 8px 0;
    label {
      @include flex(rn, a-center);
      min-height: 44px;
    }
  }
  &__check {
    flex-direction: row !important;
    align-items: center;
  }
  &__section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }
  &__activity {
    margin: 16px 0;
    padding: 12px 0;
    overflow-wrap: anywhere;
  }
  &__dialog {
    width: min(480px, calc(100vw - 32px));
    margin: auto;
    color: var(--light-text-backgroung-primary);
    border: 1px solid var(--light-text-backgroung-primary-25);
    border-radius: 12px;
    padding: 24px;
    background: var(--dark-text-background-primary);
    &::backdrop {
      background: var(--black-50);
    }
    form {
      @include flex(cn);
      gap: 16px;
    }
  }
  @media (max-width: $screen-tablet) {
    &__panel,
    &__panel_expanded {
      width: 100%;
      padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    }
    &__fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: $screen-mobile-l) {
    padding: 12px;
    gap: 12px;
    height: 100%;
    &__filters {
      flex-wrap: nowrap;
      overflow-x: auto;
      label {
        min-width: 180px;
      }
    }
    input,
    select,
    textarea {
      font-size: 16px;
    }
    &__quick {
      flex-wrap: nowrap;
      overflow-x: auto;
      flex-shrink: 0;
      button {
        white-space: nowrap;
        flex-shrink: 0;
      }
    }
    &__column {
      flex-basis: calc(100vw - 48px);
    }
  }
}
</style>
