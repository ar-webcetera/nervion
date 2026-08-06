<script setup lang="ts">
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

const startDate = ref(null);
const endDate = ref(null);
const pending = ref(false);
const employees = ref<Employee[]>([]);
const selectedProject = ref<number | null>(null);
const selectedExecutor = ref<number | null>(null);
const reportRows = ref<TimelogRow[]>([]);
const tableVisible = ref(false);
const activeBillingTab = ref<'pending' | 'reviewed'>('pending');
const targetInput = ref(0);
const billingMorePending = ref(false);

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

const isDisabled = computed(() => hasEmptyDates.value || !hasPriceEmployee.value);

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

const saveTarget = async () => {
  try {
    const now = new Date();
    await reportStore.saveTarget(now.getFullYear(), now.getMonth() + 1, Number(targetInput.value));
    $toast.success('План месяца сохранён');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const reviewBillingItem = async (item: BillingQueueItem, status: BillingReviewStatus) => {
  try {
    await reportStore.reviewItem(item, status);
  } catch (e) {
    $toast.error(getErrorMessage(e));
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

definePageMeta({
  name: 'report',
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});
</script>

<template>
  <div class="report__content">
    <div class="report__header">
      <div class="report__title">Отчеты</div>
    </div>
    <hr />
    <div v-if="pending" class="loader__container">
      <div class="loader"></div>
    </div>
    <template v-else>
      <section v-if="reportStore.dashboard" class="finance">
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
                <h2>Потенциал на {{ currentMonthLabel }}</h2>
                <p>Подтверждённый доход, записи на проверке и открытые фиксированные задачи</p>
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
              <button @click="saveTarget">Сохранить</button>
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

        <div class="finance__billing">
          <div class="finance__section-head">
            <div>
              <h2>Начисления</h2>
              <p>Проверьте ставку, сумму и дату учёта</p>
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
              </div>
              <div v-if="item.sourceType === RevenueSourceType.TIMELOG" class="finance__billing-field">
                <label>Время</label><span>{{ formatHours(item.seconds) }}</span>
              </div>
              <div class="finance__billing-field">
                <label>{{ item.sourceType === RevenueSourceType.TIMELOG ? 'Ставка, ₽/ч' : 'Сумма, ₽' }}</label>
                <input v-if="item.sourceType === RevenueSourceType.TIMELOG" v-model.number="item.rate" type="number" min="0" />
                <input v-else v-model.number="item.amount" type="number" min="0" />
              </div>
              <div class="finance__billing-field"><label>Дата учёта</label><input v-model="item.recognizedAt" type="date" /></div>
              <strong class="finance__billing-amount">{{
                money(
                  item.sourceType === RevenueSourceType.TIMELOG ? ((item.seconds ?? 0) / 3600) * (item.rate ?? 0) : item.amount,
                )
              }}</strong>
              <div v-if="activeBillingTab === 'pending'" class="finance__billing-actions">
                <button class="finance__reject" @click="reviewBillingItem(item, BillingReviewStatus.REJECTED)">
                  Не учитывать
                </button>
                <button @click="reviewBillingItem(item, BillingReviewStatus.APPROVED)">Подтвердить</button>
              </div>
              <span
                v-else
                class="finance__status"
                :class="{ finance__status_rejected: item.status === BillingReviewStatus.REJECTED }"
              >
                {{ item.status === BillingReviewStatus.APPROVED ? 'Подтверждено' : 'Не учитывается' }}
              </span>
            </article>
            <button v-if="billingHasMore" class="finance__billing-more" :disabled="billingMorePending" @click="loadMoreBillingItems">
              {{ billingMorePending ? 'Загружаем...' : 'Показать ещё' }}
            </button>
          </div>
          <p v-else class="finance__empty">Здесь пока нет записей</p>
        </div>
      </section>
      <div class="report__detail-title">
        <h2>Детальный отчёт и выгрузка</h2>
        <p>Существующий отчёт по сотрудникам и таймлогам</p>
      </div>
      <div class="report__form-container">
        <div class="report__form">
          <div class="report__input">
            <div class="report__input-header">Начало</div>
            <BaseDatePicker
              v-model="startDate"
              :type="DatePickerType.filter"
              :format-date="'dd.MM.yyyy'"
              placeholder="Выберите дату"
            />
          </div>
          <div class="report__input">
            <div class="report__input-header">Конец</div>
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
          <div class="report__input">
            <div class="report__input-header">&nbsp;</div>
            <button :class="[{ btn_disabled: isDisabled }]" @click="loadReport">Сформировать отчет</button>
          </div>
        </div>
        <hr class="report__sep" />
        <div class="report__rates-header">
          <span class="report__rates-label">Ставки сотрудников</span>
          <span v-if="!hasPriceEmployee" class="report__hint">Укажите ставку хотя бы одному сотруднику</span>
        </div>
        <div class="report__rates-grid">
          <div v-for="employee of employees" :key="employee.user_id" class="report__rate-row">
            <span class="report__rate-name">{{ employee.last_name }} {{ employee.first_name }}</span>
            <input
              class="report__rate-input"
              type="number"
              min="0"
              :value="employee.cost"
              @input="setCost(Number(($event.target as HTMLInputElement).value), employee.user_id)"
            />
            <span class="report__rate-unit">р/час</span>
          </div>
        </div>
      </div>
      <div v-if="tableVisible" class="report__data">
        <div class="report__data-toolbar">
          <span class="report__data-count">{{ reportRows.length }} записей</span>
          <button @click="unloadReport">Выгрузить в Excel</button>
        </div>
        <div class="report__table-wrap">
          <table class="report__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Исполнитель</th>
                <th>Ставка за час (руб)</th>
                <th>Название задачи</th>
                <th>Дата фиксации</th>
                <th>Расшифровка таймлога</th>
                <th>Затрачено, ч</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in reportRows" :key="i">
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
    </template>
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
    height: 100dvh;
    padding: 16px;
    min-width: 0;
    flex: 1;
    @include flex(cn);
    gap: 16px;
    overflow-y: auto;
  }

  &__header {
    @include flex(rn, a-center);
    height: 32px;
    gap: 12px;
    margin-bottom: 16px;
  }

  &__title {
    @extend %display-xs-medium;
  }

  &__form-container {
    margin-top: 16px;
    padding: 16px;
    @extend %ds-card;
    @include flex(cn);
    gap: 16px;
    width: 100%;
  }

  &__form {
    @include flex(rn, a-end);
    gap: 24px;
    flex-wrap: wrap;
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
    @extend %p14-bold;
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
    @extend %p14-bold;
    height: 20px;
  }

  &__rates-grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
    @extend %p14-bold;
  }

  &__rate-input {
    width: 64px;
    flex-shrink: 0;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    text-align: center;
    @extend %p14-bold;
    -moz-appearance: textfield;

    &::-webkit-inner-spin-button,
    &::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }

  &__rate-unit {
    @extend %p14-bold;
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
    overflow-x: auto;
    border-radius: 12px;
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
      @extend %p14-bold;
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
      @extend %p14-bold;
      border-top: 2px solid var(--light-text-backgroung-primary-5);
      border-bottom: none;
    }
  }

  &__table-total-label {
    text-align: right;
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
    border-radius: 12px;
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
    padding: 24px;
    border-radius: 16px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__forecast-main {
    min-width: 0;
  }

  &__section-head {
    @include flex(rn between a-start);
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
      @include flex(rn a-center);
      gap: 6px;
    }
  }

  &__key {
    width: 16px;
    height: 3px;
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
    @include flex(rn between a-center);
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
    border-radius: 12px;
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
    @include flex(rn between a-center);
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
    max-height: 480px;
    margin-top: 16px;
    overflow: auto;
  }
  &__billing-row {
    display: grid;
    grid-template-columns: minmax(180px, 2fr) 72px 120px 142px 112px auto;
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
    @include flex(rn);
    gap: 6px;
  }
  &__billing-actions button {
    min-height: 36px;
    padding: 8px 10px;
    @extend %p12-medium;
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
      @include flex(rn between a-center);
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
</style>
