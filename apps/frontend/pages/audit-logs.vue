<script setup lang="ts">
import type { AuditActionType, AuditEntityType, AuditLogItem, JsonObject, JsonValue } from '@tracker/contracts';
import { format, isAfter, isBefore, isValid, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import DatePickerType from '~/enums/datepicker.enums';
import type { SelectOption } from '~/types/select';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_OPTIONS,
  AUDIT_SOURCE_LABELS,
} from '~/constants/audit.constants';
import { ROLES } from '~/types/user';
import { getErrorMessage } from '~/utils/error';
import { useAuditLogStore } from '~/stores/auditLogStore';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

const { $toast } = useNuxtApp();
const auditLogStore = useAuditLogStore();
const userStore = useUserStore();

const { items, total, pending, currentItem, page, limit } = storeToRefs(auditLogStore);
const listBodyRef = ref<HTMLElement | null>(null);

const filters = reactive({
  search: '',
  actor_id: '',
  action_type: '',
  entity_type: '',
  project_id: '',
  task_id: '',
  from: '',
  to: '',
});

const actionOptions = AUDIT_ACTION_OPTIONS;
const entityOptions = AUDIT_ENTITY_OPTIONS;
const defaultFilterOption: SelectOption = { value: '', label: 'Все' };

const actorOptions = computed(() =>
  userStore.users
    .slice()
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'ru'))
    .map((user) => ({
      value: String(user.id),
      label: `${user.last_name} ${user.first_name}`.trim() || user.email,
    })),
);

const actorFilterOptions = computed<SelectOption[]>(() => [defaultFilterOption, ...actorOptions.value]);
const actionFilterOptions = computed<SelectOption[]>(() => [defaultFilterOption, ...actionOptions]);
const entityFilterOptions = computed<SelectOption[]>(() => [defaultFilterOption, ...entityOptions]);

const parseFilterDate = (value: string): Date | null => {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
};

const serializeFilterDate = (value: Date | string | number | null): string => {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : '';
};

const fromDateValue = computed<Date | null>({
  get: () => parseFilterDate(filters.from),
  set: (value) => {
    filters.from = serializeFilterDate(value);
  },
});

const toDateValue = computed<Date | null>({
  get: () => parseFilterDate(filters.to),
  set: (value) => {
    filters.to = serializeFilterDate(value);
  },
});

const disableFromDates = (date: Date) => {
  const toDate = parseFilterDate(filters.to);
  if (!toDate) return false;
  return isAfter(date, toDate);
};

const disableToDates = (date: Date) => {
  const fromDate = parseFilterDate(filters.from);
  if (!fromDate) return false;
  return isBefore(date, fromDate);
};

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

const diffEntries = computed(() => {
  if (!currentItem.value?.diff_payload) return [];

  return Object.entries(currentItem.value.diff_payload).map(([field, value]) => {
    const diffValue = (value ?? {}) as { before?: JsonValue; after?: JsonValue };
    return {
      field,
      before: diffValue.before ?? null,
      after: diffValue.after ?? null,
    };
  });
});

const buildFilters = (pageNumber = 1) => ({
  page: pageNumber,
  limit: limit.value,
  action_types: filters.action_type ? [filters.action_type as AuditActionType] : undefined,
  entity_types: filters.entity_type ? [filters.entity_type as AuditEntityType] : undefined,
  actor_id: filters.actor_id ? Number(filters.actor_id) : undefined,
  project_id: filters.project_id ? Number(filters.project_id) : undefined,
  task_id: filters.task_id ? Number(filters.task_id) : undefined,
  from: filters.from || undefined,
  to: filters.to || undefined,
  search: filters.search || undefined,
});

const loadLogs = async (pageNumber = 1) => {
  try {
    await auditLogStore.fetchLogs(buildFilters(pageNumber));
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const scrollListToTop = () => {
  listBodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
};

const applyFilters = async () => {
  await loadLogs(1);
  scrollListToTop();
};

const resetFilters = async () => {
  filters.search = '';
  filters.actor_id = '';
  filters.action_type = '';
  filters.entity_type = '';
  filters.project_id = '';
  filters.task_id = '';
  filters.from = '';
  filters.to = '';
  await loadLogs(1);
  scrollListToTop();
};

const selectLog = (item: AuditLogItem) => {
  auditLogStore.selectItem(item);
};

const changePage = async (nextPage: number) => {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return;
  await loadLogs(nextPage);
  scrollListToTop();
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
};

const formatActor = (item: AuditLogItem) => item.actor_name || item.actor?.email || 'Система';

const formatEntity = (item: AuditLogItem) => {
  const label = AUDIT_ENTITY_LABELS[item.entity_type] || item.entity_type;
  return item.entity_id ? `${label} #${item.entity_id}` : label;
};

const stringifyValue = (value: JsonValue | undefined) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
};

const prettyPayload = (payload: JsonObject | null) => {
  if (!payload) return '';
  return JSON.stringify(payload, null, 2);
};

await useAsyncData('audit-logs-init', async () => {
  await Promise.all([userStore.fetchUsers(), loadLogs(1)]);
  return true;
});
</script>

<template>
  <div class="audit-page">
    <header class="audit-page__header">
      <div>
        <h1>Журнал действий</h1>
        <p class="audit-page__subtitle">Кто, что и когда изменял в системе.</p>
      </div>
      <div class="audit-page__counter">{{ total }} событий</div>
    </header>
    <hr />

    <div class="audit-page__container">
      <form class="audit-filters" @submit.prevent="applyFilters">
        <div class="audit-filters__grid">
          <label class="audit-field audit-field_wide">
            <span>Поиск</span>
            <input v-model="filters.search" type="text" placeholder="Задача, пользователь, summary, entity id" />
          </label>
          <label class="audit-field">
            <span>Пользователь</span>
            <BaseSelect v-model="filters.actor_id" :options="actorFilterOptions" placeholder="Все" large arrow />
          </label>
          <label class="audit-field">
            <span>Действие</span>
            <BaseSelect v-model="filters.action_type" :options="actionFilterOptions" placeholder="Все" large arrow />
          </label>
          <label class="audit-field">
            <span>Сущность</span>
            <BaseSelect v-model="filters.entity_type" :options="entityFilterOptions" placeholder="Все" large arrow />
          </label>
          <label class="audit-field">
            <span>Project ID</span>
            <input v-model="filters.project_id" type="number" min="1" placeholder="Например, 14" />
          </label>
          <label class="audit-field">
            <span>Task ID</span>
            <input v-model="filters.task_id" type="number" min="1" placeholder="Например, 1046" />
          </label>
          <label class="audit-field">
            <span>С даты</span>
            <BaseDatePicker
              v-model="fromDateValue"
              :type="DatePickerType.filter"
              format-date="dd.MM.yyyy"
              placeholder="Выберите дату"
              :disabled-dates="disableFromDates"
            />
          </label>
          <label class="audit-field">
            <span>По дату</span>
            <BaseDatePicker
              v-model="toDateValue"
              :type="DatePickerType.filter"
              format-date="dd.MM.yyyy"
              placeholder="Выберите дату"
              :disabled-dates="disableToDates"
            />
          </label>
        </div>
        <div class="audit-filters__actions">
          <button class="button" type="submit">Применить</button>
          <button class="button_secondary" type="button" @click="resetFilters">Сбросить</button>
        </div>
      </form>
      <div class="audit-layout">
        <section class="audit-list">
          <header class="audit-list__header">
            <div class="audit-list__title">События</div>
            <div class="audit-list__status">{{ pending ? 'Загрузка...' : `${items.length} на странице` }}</div>
          </header>
          <div ref="listBodyRef" class="audit-list__body">
            <div v-if="!items.length && !pending" class="audit-list__empty">По выбранным фильтрам событий нет.</div>
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="audit-item"
              :class="{ 'audit-item_active': currentItem?.id === item.id }"
              @click="selectLog(item)"
            >
              <div class="audit-item__top">
                <span class="audit-badge audit-badge_entity">{{ AUDIT_ENTITY_LABELS[item.entity_type] }}</span>
                <span class="audit-badge audit-badge_action">{{ AUDIT_ACTION_LABELS[item.action_type] }}</span>
              </div>
              <div class="audit-item__summary">{{ item.summary }}</div>
              <div class="audit-item__meta">
                <span>{{ formatActor(item) }}</span>
                <span>{{ formatDateTime(item.created_at) }}</span>
              </div>
              <div class="audit-item__footer">
                <span>{{ formatEntity(item) }}</span>
                <span v-if="item.project_id">Проект #{{ item.project_id }}</span>
                <span v-if="item.task_id">Задача #{{ item.task_id }}</span>
              </div>
            </button>
          </div>
          <footer class="audit-pagination">
            <button class="button_secondary" :disabled="page <= 1 || pending" @click="changePage(page - 1)">Назад</button>
            <span>Страница {{ page }} из {{ totalPages }}</span>
            <button class="button_secondary" :disabled="page >= totalPages || pending" @click="changePage(page + 1)">
              Вперёд
            </button>
          </footer>
        </section>
        <aside class="audit-detail">
          <div v-if="currentItem" class="audit-card">
            <header class="audit-card__header">
              <div>
                <div class="audit-card__eyebrow">Детали события</div>
                <h2>{{ currentItem.summary }}</h2>
              </div>
              <div class="audit-card__badges">
                <span class="audit-badge audit-badge_entity">{{ AUDIT_ENTITY_LABELS[currentItem.entity_type] }}</span>
                <span class="audit-badge audit-badge_action">{{ AUDIT_ACTION_LABELS[currentItem.action_type] }}</span>
              </div>
            </header>
            <div class="audit-info">
              <div class="audit-info__item">
                <span>Когда</span>
                <strong>{{ formatDateTime(currentItem.created_at) }}</strong>
              </div>
              <div class="audit-info__item">
                <span>Кто</span>
                <strong>{{ formatActor(currentItem) }}</strong>
              </div>
              <div class="audit-info__item">
                <span>Источник</span>
                <strong>{{ AUDIT_SOURCE_LABELS[currentItem.source_type] }}</strong>
              </div>
              <div class="audit-info__item">
                <span>Сущность</span>
                <strong>{{ formatEntity(currentItem) }}</strong>
              </div>
              <div class="audit-info__item">
                <span>Request</span>
                <strong>{{ currentItem.request_method || '—' }} {{ currentItem.request_path || '' }}</strong>
              </div>
              <div class="audit-info__item">
                <span>Request ID</span>
                <strong>{{ currentItem.request_id || '—' }}</strong>
              </div>
              <div class="audit-info__item">
                <span>IP</span>
                <strong>{{ currentItem.ip_address || '—' }}</strong>
              </div>
              <div class="audit-info__item">
                <span>User-Agent</span>
                <strong class="audit-info__wrap">{{ currentItem.user_agent || '—' }}</strong>
              </div>
            </div>
            <section v-if="diffEntries.length" class="audit-section">
              <h3>Изменения</h3>
              <div class="audit-diff">
                <div v-for="entry in diffEntries" :key="entry.field" class="audit-diff__row">
                  <div class="audit-diff__field">{{ entry.field }}</div>
                  <div class="audit-diff__values">
                    <div class="audit-diff__value">
                      <span>Было</span>
                      <pre>{{ stringifyValue(entry.before) }}</pre>
                    </div>
                    <div class="audit-diff__value">
                      <span>Стало</span>
                      <pre>{{ stringifyValue(entry.after) }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section v-if="currentItem.before_payload" class="audit-section">
              <h3>Снимок до изменения</h3>
              <pre class="audit-json">{{ prettyPayload(currentItem.before_payload) }}</pre>
            </section>
            <section v-if="currentItem.after_payload" class="audit-section">
              <h3>Снимок после изменения</h3>
              <pre class="audit-json">{{ prettyPayload(currentItem.after_payload) }}</pre>
            </section>
            <section v-if="currentItem.metadata_payload" class="audit-section">
              <h3>Метаданные</h3>
              <pre class="audit-json">{{ prettyPayload(currentItem.metadata_payload) }}</pre>
            </section>
          </div>
          <div v-else class="audit-card audit-card_empty">Выберите событие слева, чтобы посмотреть детали.</div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.audit-page {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  @include flex(cn);
  gap: 16px;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__container {
    @include flex(cn);
    gap: 16px;
    height: 100%;
    overflow: hidden;

    @media (max-width: $screen-tablet) {
      overflow: auto;
    }
  }

  &__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;

    @media (max-width: $screen-tablet) {
      flex-direction: column;
    }
  }

  &__subtitle {
    margin: 6px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__counter {
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }
}

.audit-filters,
.audit-card,
.audit-list {
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);
  border-radius: 12px;
}

.audit-filters {
  padding: 16px;

  &__grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;

    @media (max-width: $screen-tablet) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: $screen-mobile-l) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__actions {
    margin-top: 14px;
    display: flex;
    gap: 10px;
  }
}

.audit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &_wide {
    grid-column: span 2;

    @media (max-width: $screen-mobile-l) {
      grid-column: span 1;
    }
  }

  span {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-medium;
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    &:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: none;
    }
  }

  :deep(.home-select) {
    width: 100%;
  }

  :deep(.home-select__input) {
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
  }

  :deep(.home-select__placeholder) {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }

  :deep(.home-select__arrow_small svg) {
    fill: var(--light-text-backgroung-primary-50);
  }

  :deep(.home-select__dropdown_large) {
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
  }

  :deep(.home-select__dropdown_large span) {
    color: var(--light-text-backgroung-primary);
  }

  :deep(.home-select__dropdown_large span.selected) {
    background: var(--primary-25);
    color: var(--primary);
  }

  :deep(.calendar__wrapper) {
    width: 100%;
  }

  :deep(.calendar__filter-type .dp__input_icon_pad) {
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
  }

  :deep(.calendar__filter-type .dp__input_icon) {
    right: 12px;
  }
}

.audit-layout {
  display: grid;
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  min-height: 0;
  flex: 1;
  overflow: hidden;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
    overflow: visible;
  }
}

.audit-list {
  min-height: 0;
  height: 100%;
  padding: 14px;
  @include flex(cn);
  gap: 12px;
  overflow: hidden;

  @media (max-width: $screen-tablet) {
    min-height: 300px;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  &__title {
    @extend %text-l-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__status,
  &__empty {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    @include flex(cn);
    gap: 12px;
    padding-right: 4px;
  }
}

.audit-item {
  width: 100%;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: transparent;
  border-radius: 8px;
  padding: 14px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  @include flex(cn);
  gap: 10px;

  &:hover {
    border-color: var(--light-text-backgroung-primary-20);
    background: var(--light-text-backgroung-primary-5);
  }

  &_active {
    border-color: var(--primary);
    background: var(--light-text-backgroung-primary-10);
  }

  &__top,
  &__meta,
  &__footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__summary {
    color: var(--light-text-backgroung-primary);
    @extend %text-m-medium;
    text-wrap: auto;
    text-align: center;
    hyphens: auto;
  }

  &__meta,
  &__footer {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
}

.audit-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  @extend %text-xs-medium;

  &_entity {
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary-50);
  }

  &_action {
    background: var(--light-text-backgroung-primary-10);
    color: var(--primary);
  }
}

.audit-pagination {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  color: var(--light-text-backgroung-primary-50);
  @extend %text-s-regular;

  @media (max-width: $screen-mobile-l) {
    flex-direction: column;
  }
}

.audit-detail {
  min-height: 0;
  overflow: hidden;

  @media (max-width: $screen-tablet) {
    min-height: 300px;
  }
}

.audit-card {
  height: 100%;
  padding: 16px;
  overflow: auto;

  &_empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 220px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-m-regular;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 18px;

    @media (max-width: $screen-mobile-l) {
      flex-direction: column;
    }

    h2 {
      margin: 4px 0 0;
      color: var(--light-text-backgroung-primary);
      @extend %display-xs-medium;
    }
  }

  &__eyebrow {
    color: var(--light-text-backgroung-primary-50);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    @extend %text-xs-medium;
  }

  &__badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.audit-info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;

  @media (max-width: $screen-mobile-l) {
    grid-template-columns: minmax(0, 1fr);
  }

  &__item {
    padding: 12px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn);
    gap: 6px;

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-medium;
    }

    strong {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-medium;
    }
  }

  &__wrap {
    word-break: break-word;
  }
}

.audit-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;

  h3 {
    margin: 0;
    color: var(--light-text-backgroung-primary);
    @extend %text-l-medium;
  }
}

.audit-diff {
  @include flex(cn);
  gap: 12px;

  &__row {
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    padding: 14px;
  }

  &__field {
    margin-bottom: 10px;
    color: var(--primary);
    @extend %text-s-medium;
  }

  &__values {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (max-width: $screen-mobile-l) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__value {
    @include flex(cn);
    gap: 6px;

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-medium;
    }

    pre {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      border: 1px solid var(--light-text-backgroung-primary-10);
      white-space: pre-wrap;
      word-break: break-word;
      @extend %text-xs-regular;
    }
  }
}

.audit-json {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--light-text-backgroung-primary-10);
  @extend %text-xs-regular;
}
</style>
