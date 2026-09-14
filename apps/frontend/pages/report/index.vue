<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileSpreadsheet,
  Download,
  Save,
} from '@lucide/vue';
import { ReportSection } from '~/enums/report.enums';
import { format, isBefore } from 'date-fns';
import type { Project } from '~/types/project';
import type { SelectOption } from '~/types/select';
import { type Employee, ROLES } from '~/types/user';
import type { TimelogRow } from '~/stores/reportStore';
import DatePickerType from '~/enums/datepicker.enums';
import { BillingReviewStatus, RevenueSourceType, type BillingQueueItem } from '@tracker/contracts';
import { ru } from 'date-fns/locale';
const { $toast } = useNuxtApp();

const reportStore = useReportStore();
const userStore = useUserStore();
const projectStore = useProjectStore();

const activeSection = ref(ReportSection.OVERVIEW);
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);
const pending = ref(false);
const employees = ref<Employee[]>([]);
const selectedProject = ref<number | null>(null);
const selectedExecutor = ref<number | null>(null);
const reportRows = ref<TimelogRow[]>([]);
const tableVisible = ref(false);
const activeBillingTab = ref<'pending' | 'reviewed'>('pending');
const targetInput = ref(0);
const billingMorePending = ref(false);
const billingSummaryModal = ref<{ open: () => void; close: () => void } | null>(null);
const billingSummaryItem = ref<BillingQueueItem | null>(null);
type ReportSortKey = 'project' | 'executor' | 'rate' | 'taskTitle' | 'date' | 'summary' | 'hours' | 'amount';
type SortDirection = 'asc' | 'desc';

const reportColumns: ReadonlyArray<{ key: ReportSortKey; label: string }> = [
  { key: 'project', label: 'Проект' },
  { key: 'executor', label: 'Исполнитель' },
  { key: 'rate', label: 'Ставка за час (руб)' },
  { key: 'taskTitle', label: 'Название задачи' },
  { key: 'date', label: 'Дата фиксации' },
  { key: 'summary', label: 'Расшифровка таймлога' },
  { key: 'hours', label: 'Затрачено, ч' },
  { key: 'amount', label: 'Сумма' },
];
const reportSortKey = ref<ReportSortKey>('date');
const reportSortDirection = ref<SortDirection>('desc');
const reportCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

const getReportDateValue = (value: string) => {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const [, day, month, year, hours, minutes] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
};

const compareReportRows = (left: TimelogRow, right: TimelogRow, key: ReportSortKey) => {
  if (key === 'date') return getReportDateValue(left.date) - getReportDateValue(right.date);

  const leftValue = left[key];
  const rightValue = right[key];
  if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue - rightValue;
  return reportCollator.compare(String(leftValue ?? ''), String(rightValue ?? ''));
};

const sortedReportRows = computed(() =>
  reportRows.value
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      const comparison = compareReportRows(left.row, right.row, reportSortKey.value);
      if (comparison === 0) return left.originalIndex - right.originalIndex;
      return reportSortDirection.value === 'asc' ? comparison : -comparison;
    }),
);

const toggleReportSort = (key: ReportSortKey) => {
  if (reportSortKey.value === key) {
    reportSortDirection.value = reportSortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }
  reportSortKey.value = key;
  reportSortDirection.value = 'asc';
};

const getReportAriaSort = (key: ReportSortKey): 'ascending' | 'descending' | 'none' => {
  if (reportSortKey.value !== key) return 'none';
  return reportSortDirection.value === 'asc' ? 'ascending' : 'descending';
};

const getReportSortLabel = (key: ReportSortKey, label: string) => {
  const nextDirection = reportSortKey.value === key && reportSortDirection.value === 'asc' ? 'desc' : 'asc';
  return `Сортировать столбец «${label}» по ${nextDirection === 'asc' ? 'возрастанию' : 'убыванию'}`;
};

if (userStore.user?.role !== ROLES.admin) {
  throw createError({ status: 403 });
}
const disabledDate = (date: Date) => {
  return isBefore(date, new Date(startDate.value!));
};

const getPayload = () => ({
  from: format(startDate.value!, 'yyyy-MM-dd'),
  to: format(endDate.value!, 'yyyy-MM-dd'),
  employees: employees.value,
  project_id: selectedProject.value || null,
  executor_id: selectedExecutor.value || null,
});

const loadReport = async () => {
  if (isDisabled.value) return;
  try {
    pending.value = true;
    reportRows.value = await reportStore.fetchPreview(getPayload());
    tableVisible.value = true;
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pending.value = false;
  }
};

const unloadReport = async () => {
  if (isDisabled.value) return;
  try {
    pending.value = true;
    await reportStore.unloadReport(getPayload());
    $toast('Отчет выгружен');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pending.value = false;
  }
};

await useAsyncData('report-options', async () => {
  await Promise.all([userStore.fetchUsers(), projectStore.fetchProjects()]);
  return true;
});

if (userStore.user?.role === ROLES.admin) {
  employees.value.push({
    user_id: userStore.user.id,
    cost: 0,
    first_name: userStore.user.first_name || '',
    last_name: userStore.user.last_name || '',
    patronymic: userStore.user.patronymic || '',
  });
}
userStore.users.map((user) => {
  employees.value.push({
    user_id: user.id,
    cost: 0,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    patronymic: user.patronymic || '',
  });
});

employees.value = Array.from(new Map(employees.value.map((employee) => [employee.user_id, employee])).values());

const projectOptions = computed(() => {
  if (projectStore.projects.length) {
    const projects: SelectOption[] = projectStore.projects.map((project: Project) => ({
      label: project.name,
      value: project.id,
    }));
    return projects;
  }
  return [];
});

const setCost = (cost: number, id: number) => {
  const el = employees.value.find((el) => el.user_id === id);
  if (!el) return;
  el.cost = cost;
};

const hasEmptyDates = computed(() => {
  return !startDate.value || !endDate.value;
});

const hasPriceEmployee = computed(() => {
  return employees.value.some((employee) => employee.cost! > 0);
});

const isDisabled = computed(
  () =>
    hasEmptyDates.value ||
    !hasPriceEmployee.value ||
    pending.value ||
    Boolean(startDate.value && endDate.value && endDate.value < startDate.value),
);

const executorOptions = computed<SelectOption[]>(() =>
  employees.value.map((e) => ({
    label: `${e.last_name} ${e.first_name}`.trim(),
    value: e.user_id,
  })),
);

const totalHours = computed(() => {
  return reportRows.value.reduce((sum, row) => +(sum + row.hours).toFixed(2), 0);
});

const totalAmount = computed(() => {
  return reportRows.value.reduce((sum, row) => +(sum + row.amount).toFixed(2), 0);
});

const money = (value: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
const currentMonthLabel = format(new Date(), 'LLLL yyyy', { locale: ru });
const progress = computed(() => {
  const target = reportStore.dashboard?.target ?? 0;
  return target > 0 ? Math.min(100, ((reportStore.dashboard?.actual ?? 0) / target) * 100) : 0;
});
const forecastProgress = computed(() => {
  const target = reportStore.dashboard?.target ?? 0;
  return target > 0 ? Math.min(100, ((reportStore.dashboard?.potential ?? 0) / target) * 100) : 0;
});
const maxDaily = computed(() => Math.max(1, ...(reportStore.dashboard?.daily.map((item) => item.amount) ?? [1])));
const billingItems = computed(() =>
  activeBillingTab.value === 'pending' ? reportStore.pendingItems : reportStore.reviewedItems,
);
const formatHours = (seconds: number | null) => (seconds == null ? '' : `${(seconds / 3600).toFixed(1)} ч`);

await useAsyncData('report-financial-data', async () => {
  await reportStore.fetchFinancialData();
  return true;
});
targetInput.value = reportStore.dashboard?.target ?? 0;

const targetPending = ref(false);
const saveTarget = async () => {
  if (targetPending.value || !Number.isFinite(targetInput.value) || targetInput.value < 0) return;
  targetPending.value = true;
  try {
    const now = new Date();
    await reportStore.saveTarget(now.getFullYear(), now.getMonth() + 1, Number(targetInput.value));
    $toast.success('План месяца сохранён');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    targetPending.value = false;
  }
};

const setBillingDate = (item: BillingQueueItem, value: Date | string | number | Date[] | null) => {
  if (value === null || Array.isArray(value)) return;
  item.recognizedAt =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : format(new Date(value), 'yyyy-MM-dd');
};

const billingSavePending = ref(false);
const reviewBillingItem = async (item: BillingQueueItem, status: BillingReviewStatus) => {
  if (billingSavePending.value) return;
  if (!item.recognizedAt) {
    $toast.error('Укажите дату учёта');
    return;
  }
  billingSavePending.value = true;
  try {
    await reportStore.reviewItem(item, status);
    $toast.success('Начисление сохранено');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    billingSavePending.value = false;
  }
};

const loadMoreBillingItems = async () => {
  try {
    billingMorePending.value = true;
    await reportStore.loadMoreBillingItems(activeBillingTab.value === 'pending');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    billingMorePending.value = false;
  }
};

const billingHasMore = computed(() =>
  activeBillingTab.value === 'pending' ? reportStore.pendingHasMore : reportStore.reviewedHasMore,
);

const hasBillingSummary = (item: BillingQueueItem) =>
  item.sourceType === RevenueSourceType.TIMELOG && Boolean(item.summary?.trim());

const openBillingSummary = async (item: BillingQueueItem) => {
  billingSummaryItem.value = item;
  await nextTick();
  billingSummaryModal.value?.open();
};

definePageMeta({
  name: 'report',
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});
</script>

<template>
  <div class="report__content">
    <header class="report__header">
      <div>
        <h1 class="report__title">Отчёты</h1>
        <p class="report__subtitle">Доход, начисления и отчёты по работе команды</p>
      </div>
    </header>
    <nav class="report__navigation" aria-label="Разделы отчётов">
      <button :aria-pressed="activeSection === ReportSection.OVERVIEW" @click="activeSection = ReportSection.OVERVIEW">
        <ChartNoAxesCombined :size="18" />Обзор
      </button>
      <button :aria-pressed="activeSection === ReportSection.BILLING" @click="activeSection = ReportSection.BILLING">
        <ClipboardCheck :size="18" />Начисления
        <span v-if="reportStore.pendingTotal" class="report__badge">{{ reportStore.pendingTotal }}</span>
      </button>
      <button :aria-pressed="activeSection === ReportSection.EXPORT" @click="activeSection = ReportSection.EXPORT">
        <FileSpreadsheet :size="18" />Выгрузка
      </button>
    </nav>
    <section v-if="reportStore.dashboard" v-show="activeSection !== ReportSection.EXPORT" class="finance">
      <div v-show="activeSection === ReportSection.OVERVIEW" class="finance__overview">
        <div class="finance__summary">
          <article v-for="item in reportStore.dashboard.summary" :key="item.key" class="finance__metric">
            <span>{{ item.label }}</span>
            <strong>{{ money(item.amount) }}</strong>
          </article>
        </div>

        <div class="finance__forecast">
          <div class="finance__forecast-main">
            <div class="finance__section-head">
              <div>
                <h2>Прогноз на {{ currentMonthLabel }}</h2>
                <p>Подтверждённые начисления и ожидаемый доход за месяц</p>
              </div>
              <strong>{{ money(reportStore.dashboard.potential) }}</strong>
            </div>
            <div class="finance__forecast-track" aria-label="Состав потенциального дохода">
              <span
                class="finance__forecast-part finance__forecast-part_actual"
                :style="{ flexGrow: reportStore.dashboard.actual || 0 }"
              ></span>
              <span
                class="finance__forecast-part finance__forecast-part_pending"
                :style="{ flexGrow: reportStore.dashboard.pending || 0 }"
              ></span>
              <span
                class="finance__forecast-part finance__forecast-part_open"
                :style="{ flexGrow: reportStore.dashboard.openFixed || 0 }"
              ></span>
            </div>
            <div class="finance__legend">
              <span><i class="finance__key finance__key_actual"></i>Факт: {{ money(reportStore.dashboard.actual) }}</span>
              <span
                ><i class="finance__key finance__key_pending"></i>На проверке: {{ money(reportStore.dashboard.pending) }}</span
              >
              <span><i class="finance__key finance__key_open"></i>В работе: {{ money(reportStore.dashboard.openFixed) }}</span>
            </div>
          </div>
          <div class="finance__target">
            <div class="finance__target-head">
              <span>План месяца</span>
              <strong>{{ Math.round(progress) }}%</strong>
            </div>
            <div class="finance__target-input">
              <input v-model.number="targetInput" type="number" min="0" step="1000" aria-label="План дохода на месяц" />
              <button
                :disabled="targetPending || targetInput < 0 || targetInput === reportStore.dashboard.target"
                @click="saveTarget"
              >
                {{ targetPending ? 'Сохраняем…' : 'Сохранить' }}
              </button>
            </div>
            <div class="finance__target-scale">
              <span class="finance__target-fact" :style="{ width: `${progress}%` }"></span>
              <span class="finance__target-forecast" :style="{ width: `${forecastProgress}%` }"></span>
            </div>
            <p>По прогнозу: {{ Math.round(forecastProgress) }}% плана</p>
          </div>
        </div>

        <div class="finance__charts">
          <div class="finance__chart">
            <div class="finance__section-head"><h2>Доход по дням</h2></div>
            <div v-if="reportStore.dashboard.daily.length" class="finance__bars">
              <div v-for="item in reportStore.dashboard.daily" :key="item.label" class="finance__bar-row">
                <time>{{ format(new Date(`${item.label}T12:00:00`), 'd MMM', { locale: ru }) }}</time>
                <span><i :style="{ width: `${(item.amount / maxDaily) * 100}%` }"></i></span>
                <strong>{{ money(item.amount) }}</strong>
              </div>
            </div>
            <p v-else class="finance__empty">В этом месяце пока нет подтверждённого дохода</p>
          </div>
          <div class="finance__chart">
            <div class="finance__section-head"><h2>По проектам</h2></div>
            <div v-if="reportStore.dashboard.projects.length" class="finance__projects">
              <div v-for="item in reportStore.dashboard.projects" :key="item.label">
                <span>{{ item.label }}</span
                ><strong>{{ money(item.amount) }}</strong>
              </div>
            </div>
            <p v-else class="finance__empty">Данных по проектам пока нет</p>
          </div>
        </div>
      </div>
      <div v-show="activeSection === ReportSection.BILLING" class="finance__billing">
        <div class="finance__section-head">
          <div>
            <h2>Начисления</h2>
            <p>Сохраните правки отдельно или подтвердите запись, чтобы включить её в доход</p>
          </div>
          <div class="finance__tabs">
            <button :class="{ finance__tab_active: activeBillingTab === 'pending' }" @click="activeBillingTab = 'pending'">
              Требуют проверки <span>{{ reportStore.pendingTotal }}</span>
            </button>
            <button :class="{ finance__tab_active: activeBillingTab === 'reviewed' }" @click="activeBillingTab = 'reviewed'">
              Проверенные
            </button>
          </div>
        </div>
        <div v-if="billingItems.length" class="finance__billing-list">
          <article v-for="item in billingItems" :key="`${item.sourceType}-${item.id}`" class="finance__billing-row">
            <div class="finance__billing-source">
              <span>{{ item.sourceType === RevenueSourceType.TIMELOG ? 'Таймтрек' : 'Фиксированная задача' }}</span>
              <strong>{{ item.task }}</strong>
              <small
                >{{ item.project }}<template v-if="item.executor"> · {{ item.executor }}</template></small
              >
              <button
                v-if="hasBillingSummary(item)"
                type="button"
                class="finance__billing-summary-btn"
                @click="openBillingSummary(item)"
              >
                Описание
              </button>
            </div>
            <div class="finance__billing-field">
              <label>Время</label
              ><span>{{ item.sourceType === RevenueSourceType.TIMELOG ? formatHours(item.seconds) : '—' }}</span>
            </div>
            <div class="finance__billing-field">
              <label>{{ item.sourceType === RevenueSourceType.TIMELOG ? 'Ставка, ₽/ч' : 'Сумма, ₽' }}</label>
              <input
                v-if="item.sourceType === RevenueSourceType.TIMELOG"
                v-model.number="item.rate"
                :aria-label="`Ставка: ${item.task}`"
                type="number"
                min="0"
                :disabled="billingSavePending"
              />
              <input
                v-else
                v-model.number="item.amount"
                :aria-label="`Сумма: ${item.task}`"
                type="number"
                min="0"
                :disabled="billingSavePending"
              />
            </div>
            <div class="finance__billing-field">
              <label>Дата учёта</label
              ><BaseDatePicker
                :model-value="item.recognizedAt"
                :type="DatePickerType.filter"
                format-date="dd.MM.yyyy"
                placeholder="Выберите дату"
                :disabled="billingSavePending"
                @update:model-value="setBillingDate(item, $event)"
              />
            </div>
            <strong class="finance__billing-amount">{{
              money(item.sourceType === RevenueSourceType.TIMELOG ? ((item.seconds ?? 0) / 3600) * (item.rate ?? 0) : item.amount)
            }}</strong>
            <div class="finance__billing-actions">
              <button
                class="report__button-secondary"
                :disabled="billingSavePending"
                @click="reviewBillingItem(item, item.status)"
              >
                <Save :size="14" />Сохранить
              </button>
              <button
                v-if="activeBillingTab === 'pending'"
                class="finance__reject"
                :disabled="billingSavePending"
                @click="reviewBillingItem(item, BillingReviewStatus.REJECTED)"
              >
                Не учитывать
              </button>
              <button
                v-if="activeBillingTab === 'pending'"
                :disabled="billingSavePending"
                @click="reviewBillingItem(item, BillingReviewStatus.APPROVED)"
              >
                Подтвердить
              </button>
              <span
                v-if="activeBillingTab !== 'pending'"
                class="finance__status"
                :class="{ finance__status_rejected: item.status === BillingReviewStatus.REJECTED }"
              >
                {{ item.status === BillingReviewStatus.APPROVED ? 'Подтверждено' : 'Не учитывается' }}
              </span>
            </div>
          </article>
          <button
            v-if="billingHasMore"
            class="finance__billing-more"
            :disabled="billingMorePending"
            @click="loadMoreBillingItems"
          >
            {{ billingMorePending ? 'Загружаем...' : 'Показать ещё' }}
          </button>
        </div>
        <div v-else class="finance__empty-state">
          <ClipboardCheck :size="28" />
          <h3>{{ activeBillingTab === 'pending' ? 'Всё проверено' : 'Пока нет проверенных начислений' }}</h3>
          <p>
            {{
              activeBillingTab === 'pending'
                ? 'Новые записи появятся после завершения работы по задачам.'
                : 'Подтвердите запись во вкладке «Требуют проверки».'
            }}
          </p>
        </div>
      </div>
    </section>
    <section v-show="activeSection === ReportSection.EXPORT" class="report__export">
      <div class="report__detail-title">
        <h2>Отчёт по выполненной работе</h2>
        <p>Выберите период и ставки для расчёта. Результат можно скачать в Excel.</p>
      </div>
      <div class="report__form-container">
        <div class="report__form">
          <div class="report__input">
            <div class="report__input-header">С даты</div>
            <BaseDatePicker
              v-model="startDate"
              :type="DatePickerType.filter"
              :format-date="'dd.MM.yyyy'"
              placeholder="Выберите дату"
            />
          </div>
          <div class="report__input">
            <div class="report__input-header">По дату</div>
            <BaseDatePicker
              v-model="endDate"
              :format-date="'dd.MM.yyyy'"
              :type="DatePickerType.filter"
              placeholder="Выберите дату"
              :disabled-dates="disabledDate"
              :disabled="!startDate"
            />
          </div>
          <div class="report__input">
            <div class="report__input-header">Проект</div>
            <BaseSelect
              v-model="selectedProject"
              :options="projectOptions"
              placeholder="Все проекты"
              reset-button
              large
              arrow
              @reset="selectedProject = null"
            />
          </div>
          <div class="report__input">
            <div class="report__input-header">Исполнитель</div>
            <BaseSelect
              v-model="selectedExecutor"
              :options="executorOptions"
              placeholder="Все исполнители"
              reset-button
              large
              arrow
              @reset="selectedExecutor = null"
            />
          </div>
        </div>
        <hr class="report__sep" />
        <details class="report__rates" open>
          <summary class="report__rates-header">
            <span class="report__rates-label">Ставки сотрудников</span>
            <span v-if="!hasPriceEmployee" class="report__hint">Укажите ставку хотя бы одному сотруднику</span>
          </summary>
          <div class="report__rates-grid">
            <div v-for="employee of employees" :key="employee.user_id" class="report__rate-row">
              <span class="report__rate-name">{{ employee.last_name }} {{ employee.first_name }}</span>
              <input
                class="report__rate-input"
                :aria-label="`Ставка в рублях за час: ${employee.last_name} ${employee.first_name}`"
                type="number"
                min="0"
                :value="employee.cost"
                @input="setCost(Number(($event.target as HTMLInputElement).value), employee.user_id)"
              />
              <span class="report__rate-unit">₽/ч</span>
            </div>
          </div>
        </details>
        <div class="report__form-actions">
          <span class="report__hint">{{
            hasEmptyDates
              ? 'Выберите начало и конец периода'
              : !hasPriceEmployee
                ? 'Укажите ставку хотя бы одному сотруднику'
                : 'Ставки применяются только к этой выгрузке'
          }}</span
          ><button :disabled="isDisabled" @click="loadReport">{{ pending ? 'Формируем…' : 'Сформировать отчёт' }}</button>
        </div>
      </div>
      <div v-if="tableVisible" class="report__data">
        <div class="report__data-toolbar">
          <span class="report__data-count">{{ reportRows.length }} записей</span>
          <button :disabled="isDisabled" @click="unloadReport">
            <Download :size="16" />{{ pending ? 'Подготовка…' : 'Скачать Excel' }}
          </button>
        </div>
        <p v-if="!reportRows.length" class="finance__empty">
          За выбранный период записей не найдено. Попробуйте изменить фильтры.
        </p>
        <div v-else class="report__table-wrap">
          <table class="report__table">
            <thead>
              <tr>
                <th v-for="column of reportColumns" :key="column.key" :aria-sort="getReportAriaSort(column.key)">
                  <button
                    type="button"
                    class="report__sort-button"
                    :class="{ 'report__sort-button_active': reportSortKey === column.key }"
                    :aria-label="getReportSortLabel(column.key, column.label)"
                    @click="toggleReportSort(column.key)"
                  >
                    <span>{{ column.label }}</span>
                    <ArrowUpDown v-if="reportSortKey !== column.key" :size="16" aria-hidden="true" />
                    <ArrowUp v-else-if="reportSortDirection === 'asc'" :size="16" aria-hidden="true" />
                    <ArrowDown v-else :size="16" aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="{ row, originalIndex } of sortedReportRows" :key="originalIndex">
                <td>{{ row.project }}</td>
                <td>{{ row.executor }}</td>
                <td>{{ row.rate }}</td>
                <td>{{ row.taskTitle }}</td>
                <td>{{ row.date }}</td>
                <td>{{ row.summary }}</td>
                <td>{{ row.hours }}</td>
                <td>{{ row.amount }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6" class="report__table-total-label">Итого</td>
                <td>{{ totalHours }}</td>
                <td>{{ totalAmount }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
    <teleport to="#teleports">
      <BaseModal ref="billingSummaryModal" @close="billingSummaryItem = null">
        <div v-if="billingSummaryItem" class="finance-summary-modal">
          <h2 class="finance-summary-modal__title">Описание таймтрека</h2>
          <p class="finance-summary-modal__meta">
            {{ billingSummaryItem.task }}
            <template v-if="billingSummaryItem.project"> · {{ billingSummaryItem.project }}</template>
            <template v-if="billingSummaryItem.executor"> · {{ billingSummaryItem.executor }}</template>
          </p>
          <p class="finance-summary-modal__text">{{ billingSummaryItem.summary }}</p>
        </div>
      </BaseModal>
    </teleport>
  </div>
</template>

<style scoped lang="scss">
.loader {
  &__container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
}
.report {
  &__content {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 16px;
    min-width: 0;
    flex: 1;
    @include flex(cn);
    gap: 16px;
    overflow-y: auto;
  }

  &__header {
    @include flex(rn, a-center);
    min-height: 48px;
    gap: 12px;
    flex-shrink: 0;
  }

  &__title {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__form-container {
    padding: 16px;
    @extend %ds-card;
    @include flex(cn);
    gap: 16px;
    width: 100%;
  }

  &__form {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  &__sep {
    width: 100%;
    border: none;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    margin: 0;
  }

  &__rates-header {
    @include flex(rn, a-center);
    gap: 12px;
  }

  &__rates-label {
    @extend %text-s-medium;
  }

  &__hint {
    @extend %text-xs-regular;
    opacity: 0.5;
  }

  &__input {
    @include flex(cn, a-start);
    gap: 8px;

    :deep(.home-select__input_large) {
      padding: 6px 12px;
    }
  }

  &__input-header {
    @extend %text-s-medium;
    height: 20px;
  }

  &__rates-grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  &__rate-row {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    min-width: 0;
  }

  &__rate-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-medium;
  }

  &__rate-input {
    width: 64px;
    flex-shrink: 0;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    text-align: left;
    @extend %text-s-medium;
    -moz-appearance: textfield;

    &::-webkit-inner-spin-button,
    &::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }

  &__rate-unit {
    @extend %text-s-medium;
    flex-shrink: 0;
  }

  &__data {
    width: 100%;
    margin-top: 16px;
    @include flex(cn);
    gap: 12px;
  }

  &__data-toolbar {
    @include flex(rn, a-center, between);
    width: 100%;
  }

  &__data-count {
    @extend %text-s-regular;
    opacity: 0.5;
  }

  &__table-wrap {
    width: 100%;
    overflow: auto;
    max-height: 60vh;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
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
      @extend %text-s-medium;
      padding: 0;
      background: var(--light-text-backgroung-primary-5);
      position: sticky;
      top: 0;
      z-index: 1;
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

    tfoot td {
      @extend %text-s-medium;
      border-top: 2px solid var(--light-text-backgroung-primary-5);
      border-bottom: none;
    }
  }

  &__table-total-label {
    text-align: right;
  }

  &__sort-button {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
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

  &__detail-title {
    width: 100%;
    margin-top: 16px;

    h2 {
      margin: 0;
      @extend %h1;
    }
    p {
      margin: 4px 0 0;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
  }
}

.finance {
  width: 100%;
  min-width: 0;
  @include flex(cn);
  gap: 16px;

  &__summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }

  &__metric {
    min-width: 0;
    padding: 16px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);

    span {
      display: block;
      color: var(--light-text-backgroung-primary-50);
      @extend %p12-regular;
    }
    strong {
      display: block;
      margin-top: 8px;
      @extend %text-xl-medium;
      font-variant-numeric: tabular-nums;
    }
  }

  &__forecast {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 16px;
    padding: 20px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__forecast-main {
    min-width: 0;
  }

  &__section-head {
    @include flex(rn, between, a-start);
    gap: 16px;

    h2 {
      margin: 0;
      @extend %h1;
    }
    p {
      margin: 4px 0 0;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
    > strong {
      @extend %display-xs-medium;
      font-variant-numeric: tabular-nums;
    }
  }

  &__forecast-track {
    width: 100%;
    height: 20px;
    margin-top: 24px;
    @include flex(rn);
    gap: 3px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-10);
  }

  &__forecast-part {
    min-width: 0;
    &_actual {
      background: var(--green);
    }
    &_pending {
      background: var(--secondary);
    }
    &_open {
      background: var(--primary);
    }
  }

  &__legend {
    margin-top: 12px;
    @include flex(rw);
    gap: 8px 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-regular;

    span {
      @include flex(rn, a-center);
      gap: 6px;
      line-height: 1.25;
    }
  }

  &__key {
    display: block;
    flex-shrink: 0;
    width: 16px;
    height: 4px;
    border-radius: 2px;
    &_actual {
      background: var(--green);
    }
    &_pending {
      background: var(--secondary);
    }
    &_open {
      background: var(--primary);
    }
  }

  &__target {
    padding-left: 24px;
    border-left: 1px solid var(--light-text-backgroung-primary-10);

    p {
      margin: 8px 0 0;
      color: var(--light-text-backgroung-primary-50);
      @extend %p12-regular;
    }
  }

  &__target-head {
    @include flex(rn, between, a-center);
    @extend %text-s-medium;
  }
  &__target-input {
    margin-top: 12px;
    @include flex(rn);
    gap: 8px;

    input {
      min-width: 0;
      flex: 1;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--dark-text-background-primary);
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;
    }
    button {
      padding: 10px 12px;
    }
  }

  &__target-scale {
    position: relative;
    height: 8px;
    margin-top: 16px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--light-text-backgroung-primary-10);
  }

  &__target-fact,
  &__target-forecast {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 4px;
  }
  &__target-forecast {
    background: var(--primary-50);
  }
  &__target-fact {
    z-index: 1;
    background: var(--green);
  }

  &__charts {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);
    gap: 16px;
  }
  &__chart,
  &__billing {
    min-width: 0;
    padding: 20px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
  }
  &__bars,
  &__projects {
    margin-top: 16px;
    @include flex(cn);
    gap: 10px;
  }
  &__bar-row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 104px;
    gap: 12px;
    align-items: center;
    @extend %p12-regular;

    time {
      color: var(--light-text-backgroung-primary-50);
    }
    > span {
      height: 6px;
      overflow: hidden;
      border-radius: 3px;
      background: var(--light-text-backgroung-primary-10);
    }
    i {
      display: block;
      height: 100%;
      border-radius: 3px;
      background: var(--green);
    }
    strong {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }

  &__projects div {
    @include flex(rn, between, a-center);
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    @extend %text-s-regular;
  }
  &__projects strong {
    font-variant-numeric: tabular-nums;
  }
  &__empty,
  &__loading {
    margin: 16px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
  &__loading {
    width: 100%;
    padding: 24px;
    text-align: left;
  }

  &__tabs {
    @include flex(rn);
    gap: 4px;
    padding: 4px;
    border-radius: 10px;
    background: var(--dark-text-background-primary);
  }
  &__tabs button {
    min-height: 36px;
    padding: 8px 12px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-medium;
  }
  &__tabs span {
    margin-left: 4px;
  }
  &__tab_active {
    background: var(--light-text-backgroung-primary-10) !important;
    color: var(--light-text-backgroung-primary) !important;
  }
  &__billing-list {
    max-height: none;
    margin-top: 16px;
    overflow: auto;
  }
  &__billing-row {
    display: grid;
    grid-template-columns: minmax(200px, 2fr) 64px 120px 148px 112px;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }
  &__billing-more {
    width: 100%;
    min-height: 44px;
    margin-top: 12px;
    background: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__billing-source {
    min-width: 0;
    @include flex(cn);
    gap: 3px;
  }
  &__billing-source span {
    color: var(--primary-75);
    @extend %p12-medium;
  }
  &__billing-source strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-s-medium;
  }
  &__billing-source small {
    overflow: hidden;
    color: var(--light-text-backgroung-primary-50);
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %p12-regular;
  }
  &__billing-summary-btn {
    width: fit-content;
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--primary-75);
    cursor: pointer;
    @extend %p12-medium;

    &:hover {
      color: var(--primary);
    }
  }
  &__billing-field {
    @include flex(cn);
    gap: 4px;
  }
  &__billing-field label {
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-regular;
  }
  &__billing-field input {
    width: 100%;
    min-height: 36px;
    padding: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    color: var(--light-text-backgroung-primary);
    @extend %p12-regular;
  }
  &__billing-amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
    @extend %text-s-medium;
  }
  &__billing-actions {
    @include flex(rw, a-center);
    gap: 6px;
  }
  &__billing-actions button {
    min-height: 36px;
    padding: 8px 10px;
    @extend %p12-medium;
    &:disabled {
      opacity: 0.5;
      cursor: wait;
    }
  }
  &__reject {
    background: var(--light-text-backgroung-primary-10) !important;
  }
  &__status {
    color: var(--green);
    @extend %p12-medium;
    &_rejected {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  @media (max-width: $screen-desktop-l) {
    &__summary {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    &__forecast,
    &__charts {
      grid-template-columns: minmax(0, 1fr);
    }
    &__target {
      padding: 16px 0 0;
      border-top: 1px solid var(--light-text-backgroung-primary-10);
      border-left: 0;
    }
    &__billing-row {
      grid-template-columns: minmax(180px, 2fr) 72px 120px 142px;
    }
    &__billing-amount,
    &__billing-actions,
    &__status {
      grid-column: auto;
    }
  }

  @media (max-width: $screen-tablet) {
    &__summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    &__forecast {
      padding: 16px;
    }
    &__section-head {
      flex-direction: column;
    }
    &__tabs {
      width: 100%;
      overflow-x: auto;
    }
    &__billing-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: end;
    }
    &__billing-source {
      grid-column: 1 / -1;
    }
    &__billing-amount {
      text-align: left;
    }
    &__billing-actions {
      grid-column: 1 / -1;
    }
    &__billing-actions button {
      min-height: 44px;
      flex: 1;
    }
  }

  @media (max-width: $screen-mobile-l) {
    &__summary {
      grid-template-columns: minmax(0, 1fr);
    }
    &__metric {
      padding: 12px 16px;
      @include flex(rn, between, a-center);
    }
    &__metric strong {
      margin-top: 0;
    }
    &__bar-row {
      grid-template-columns: 44px minmax(0, 1fr) 88px;
      gap: 8px;
    }
  }
}

.report {
  &__subtitle {
    margin: 4px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }
  &__navigation {
    @include flex(rn, a-center);
    gap: 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
    button {
      @include flex(rn, a-center, j-start);
      gap: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-medium;
      &[aria-pressed='true'] {
        background: var(--primary-25);
        color: var(--light-text-backgroung-primary);
      }
      &:hover {
        background: var(--light-text-backgroung-primary-10);
      }
    }
  }
  &__badge {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--light-text-backgroung-primary-10);
    @extend %text-xs-medium;
  }
  &__export {
    @include flex(cn);
    gap: 16px;
    min-width: 0;
  }
  &__detail-title {
    margin-top: 0;
  }
  &__input {
    min-width: 0;
    align-items: stretch;
  }
  &__input-header {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary-50);
  }
  &__input :deep(.calendar__wrapper) {
    width: 100%;
    min-width: 0;
  }
  &__input :deep(.calendar) {
    width: 100%;
    min-width: 0;
  }
  &__input :deep(.dp__input) {
    box-sizing: border-box;
    width: 100%;
    min-height: 36px;
    padding: 6px 36px 6px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
  }
  &__input :deep(.dp__input_icon) {
    right: 10px;
    left: auto;
  }
  &__input :deep(.home-select__input) {
    box-sizing: border-box;
    min-height: 36px;
  }
  &__form-actions {
    @include flex(rw, a-center, between);
    gap: 12px;
  }
  &__rates-header {
    cursor: pointer;
    padding: 4px 0;
  }
  &__rates-grid {
    margin-top: 12px;
  }
  &__rate-input {
    width: 80px;
    color: var(--light-text-backgroung-primary);
    box-sizing: border-box;
  }
  &__button-secondary {
    background: var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
  }
  &__content {
    button {
      @include flex(rn, a-center, j-center);
      gap: 6px;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    button:focus-visible,
    input:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    input {
      box-sizing: border-box;
      min-width: 0;
      color-scheme: dark;
    }
  }
  &__table {
    th {
      background: var(--dark-text-background-primary);
    }
    td:nth-child(4),
    td:nth-child(6) {
      min-width: 220px;
      max-width: 360px;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    td:nth-child(3),
    td:nth-child(7),
    td:nth-child(8) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }
}
.finance {
  &__overview {
    @include flex(cn);
    gap: 16px;
  }
  &__billing {
    background: transparent;
    padding: 0;
  }
  &__billing-row {
    min-width: 0;
  }
  &__billing-field {
    min-width: 0;
    > span {
      @include flex(rn, a-center);
      min-height: 36px;
      flex-shrink: 0;
      @extend %text-s-regular;
    }
    :deep(.calendar__wrapper),
    :deep(.calendar) {
      min-width: 0;
      width: 100%;
    }
    :deep(.dp__input) {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 8px 30px 8px 8px;
      background: var(--dark-text-background-primary);
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      @extend %p12-regular;
    }
    :deep(.dp__input_icon) {
      right: 8px;
      left: auto;
    }
    :deep(.calendar__wrapper > svg) {
      display: none;
    }
  }
  &__billing-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
  &__billing-actions .report__button-secondary {
    margin-right: auto;
  }
  &__billing-source strong {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  &__empty-state {
    @include flex(cn, a-start);
    gap: 8px;
    padding: 32px 0;
    color: var(--light-text-backgroung-primary-50);
    h3 {
      margin: 0;
      @extend %text-m-medium;
      color: var(--light-text-backgroung-primary);
    }
    p {
      margin: 0;
      @extend %text-s-regular;
    }
  }
  &__tabs button {
    white-space: nowrap;
  }
  &__charts {
    align-items: start;
  }
  &__bars,
  &__projects {
    max-height: 300px;
    overflow-y: auto;
  }
  &__projects div > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  &__projects strong {
    white-space: nowrap;
  }
}
@media (max-width: $screen-desktop-l) {
  .report__form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .report__rates-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .finance__billing-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  }
  .finance__billing-source {
    grid-column: 1 / -1;
  }
}
@media (max-width: $screen-tablet) {
  .report__content {
    padding: 12px;
  }
  .report__navigation {
    overflow-x: auto;
    button {
      min-height: 44px;
      white-space: nowrap;
    }
  }
  .report__rates-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .report__rates-header {
    flex-wrap: wrap;
  }
  .report__form-actions button {
    width: 100%;
    min-height: 44px;
  }
  .finance__billing-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .finance__target-input {
    flex-wrap: wrap;
    input {
      min-width: 100px;
    }
  }
  .finance__section-head > strong {
    overflow-wrap: anywhere;
    max-width: 100%;
  }
}
@media (max-width: $screen-mobile-l) {
  .report__form {
    grid-template-columns: minmax(0, 1fr);
  }
  .report__navigation {
    gap: 0;
    button {
      padding: 8px;
      svg {
        display: none;
      }
    }
  }
}

.finance-summary-modal {
  padding: 8px 24px 24px;
  @include flex(cn);
  gap: 12px;

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__meta {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__text {
    margin: 0;
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    @extend %text-s-regular;
  }
}
</style>
