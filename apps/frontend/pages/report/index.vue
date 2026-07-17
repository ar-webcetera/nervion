<script setup lang="ts">
import { format, isBefore } from 'date-fns';
import type { Project } from '~/types/project';
import type { SelectOption } from '~/types/select';
import { type Employee, ROLES } from '~/types/user';
import type { TimelogRow } from '~/stores/reportStore';
import DatePickerType from '~/enums/datepicker.enums';
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
}
</style>
