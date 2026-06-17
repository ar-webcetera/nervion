<script setup lang="ts">
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, startOfMonth, endOfMonth } from 'date-fns';
import { useAllocationStore } from '~/stores/allocationStore';
import { useUserStore } from '~/stores/userStore';
import { useProjectStore } from '~/stores/projectStore';
import type { Allocation, CreateAllocationDto } from '~/types/allocation';
import type { User } from '~/types/user';
import { ROLES } from '~/types/user';
import ResourceTimeline from '~/components/ResourceTimeline.vue';
import AllocationModal from '~/components/AllocationModal.vue';

interface TimelogSummaryItem {
  user_id: number;
  user: Allocation['user'];
  project_id: number;
  project: Allocation['project'];
  start_date: string;
  end_date: string;
  hours: number;
}

const allocationStore = useAllocationStore();
const userStore = useUserStore();
const projectStore = useProjectStore();
const { $toast } = useNuxtApp();

const formatDate = (date: Date): string => format(date, 'yyyy-MM-dd');

const loading = ref(false);
const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized;
};
const currentWeekStart = ref(startOfWeek(normalizeDate(new Date()), { weekStartsOn: 1 }));
const showModal = ref(false);
const selectedAllocation = ref<Allocation | null>(null);
const prefilledUser = ref<User | null>(null);
const prefilledDate = ref<Date | null>(null);
const isSummaryExpanded = ref(false);
const viewModeCookie = useCookie<'plan' | 'actual'>('planning-view-mode', {
  default: () => 'plan',
  maxAge: 60 * 60 * 24 * 365, // 1 год
});
const viewMode = ref<'plan' | 'actual'>(viewModeCookie.value);
const actualData = useState<Allocation[]>('planning-actual-data', () => []);
const summaryPeriod = ref<'week' | 'month'>('week');
const monthData = useState<Allocation[]>('planning-month-data', () => []);

const currentWeekEnd = computed(() => endOfWeek(currentWeekStart.value, { weekStartsOn: 1 }));
const currentMonthStart = computed(() => startOfMonth(currentWeekStart.value));
const currentMonthEnd = computed(() => endOfMonth(currentWeekEnd.value));

const canEdit = computed(() => userStore.user?.role === ROLES.admin);

const detailedSummary = computed(() => {
  const summary = new Map<string, Map<string, { userName: string; hours: number }>>();
  const data = summaryData.value;

  data.forEach((allocation) => {
    const projectKey = allocation.project.id.toString();
    const userKey = allocation.user.id.toString();
    const userName = `${allocation.user.first_name} ${allocation.user.last_name}`;

    if (!summary.has(projectKey)) {
      summary.set(projectKey, new Map());
    }

    const projectMap = summary.get(projectKey)!;
    if (!projectMap.has(userKey)) {
      projectMap.set(userKey, { userName, hours: 0 });
    }

    const userItem = projectMap.get(userKey)!;
    userItem.hours += allocation.hours;
  });

  const result: Array<{
    projectId: string;
    projectName: string;
    totalHours: number;
    users: Array<{ userName: string; hours: number }>;
  }> = [];

  summary.forEach((users, projectId) => {
    const project = data.find((a) => a.project.id.toString() === projectId)?.project;
    if (!project) return;

    const usersList = Array.from(users.values())
      .map((u) => ({ ...u, hours: parseFloat(u.hours.toFixed(2)) }))
      .sort((a, b) => b.hours - a.hours);
    const totalHours = parseFloat(usersList.reduce((sum, u) => sum + u.hours, 0).toFixed(2));

    result.push({
      projectId,
      projectName: project.name,
      totalHours,
      users: usersList,
    });
  });

  return result.sort((a, b) => b.totalHours - a.totalHours);
});

const summaryData = computed(() => {
  if (summaryPeriod.value === 'month') {
    return viewMode.value === 'plan' ? allocationStore.allocations : monthData.value;
  }
  return viewMode.value === 'plan' ? allocationStore.allocations : actualData.value;
});

const totalHours = computed(() => {
  const total = summaryData.value.reduce((sum, allocation) => sum + allocation.hours, 0);
  return parseFloat(total.toFixed(2));
});

const periodLabel = computed(() => {
  if (summaryPeriod.value === 'month') {
    const months = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];
    const startDate = currentMonthStart.value;
    const endDate = currentMonthEnd.value;

    if (startDate.getMonth() !== endDate.getMonth()) {
      const startMonth = months[startDate.getMonth()];
      const endMonth = months[endDate.getMonth()];
      if (startDate.getFullYear() !== endDate.getFullYear()) {
        return `${startMonth} ${startDate.getFullYear()} - ${endMonth} ${endDate.getFullYear()}`;
      }
      return `${startMonth} - ${endMonth} ${endDate.getFullYear()}`;
    }

    return `${months[startDate.getMonth()]} ${startDate.getFullYear()}`;
  }
  const startDay = currentWeekStart.value.getDate();
  const endDay = currentWeekEnd.value.getDate();
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const startMonth = months[currentWeekStart.value.getMonth()];
  const endMonth = months[currentWeekEnd.value.getMonth()];
  const year = currentWeekEnd.value.getFullYear();

  if (currentWeekStart.value.getMonth() === currentWeekEnd.value.getMonth()) {
    return `${startDay}-${endDay} ${endMonth} ${year}`;
  }
  return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${year}`;
});

const displayedAllocations = computed(() => {
  return viewMode.value === 'plan' ? allocationStore.allocations : actualData.value;
});

const fetchActualData = async () => {
  try {
    const config = useRuntimeConfig();
    const headers = useRequestHeaders(['cookie']);

    const response = await $fetch<TimelogSummaryItem[]>(`/api/timelogs/summary`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      query: {
        start_date: formatDate(currentWeekStart.value),
        end_date: formatDate(currentWeekEnd.value),
      },
    });

    actualData.value = response.map((item, index) => {
      const dateNum = new Date(item.start_date).getTime();
      const uniqueId = parseInt(`${item.user_id}${item.project_id}${dateNum}${index}`.slice(0, 15));

      return {
        id: uniqueId,
        user_id: item.user_id,
        user: item.user,
        project_id: item.project_id,
        project: item.project,
        start_date: item.start_date,
        end_date: item.end_date,
        start_time: null,
        end_time: null,
        hours: item.hours,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });
  } catch (e: unknown) {
    const error = e as Error;
    if (!import.meta.server) {
      $toast.error(error.message || 'Ошибка загрузки фактических данных');
    }
  }
};

const fetchMonthData = async () => {
  try {
    const config = useRuntimeConfig();
    const headers = useRequestHeaders(['cookie']);

    const response = await $fetch<TimelogSummaryItem[]>(`/api/timelogs/summary`, {
      baseURL: config.public.API_URL,
      method: 'GET',
      credentials: 'include',
      headers,
      query: {
        start_date: formatDate(currentMonthStart.value),
        end_date: formatDate(currentMonthEnd.value),
      },
    });

    monthData.value = response.map((item, index) => {
      const dateNum = new Date(item.start_date).getTime();
      const uniqueId = parseInt(`${item.user_id}${item.project_id}${dateNum}${index}`.slice(0, 15));

      return {
        id: uniqueId,
        user_id: item.user_id,
        user: item.user,
        project_id: item.project_id,
        project: item.project,
        start_date: item.start_date,
        end_date: item.end_date,
        start_time: null,
        end_time: null,
        hours: item.hours,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    });
  } catch (e: unknown) {
    const error = e as Error;
    if (!import.meta.server) {
      $toast.error(error.message || 'Ошибка загрузки данных за месяц');
    }
  }
};

await useAsyncData('planning-initial-data', async () => {
  try {
    return await Promise.all([
      allocationStore.fetchAllocations({
        start_date: formatDate(currentWeekStart.value),
        end_date: formatDate(currentWeekEnd.value),
      }),
      userStore.fetchUsers(),
      projectStore.projects.length ? Promise.resolve() : projectStore.fetchProjects(),
      fetchActualData(),
      fetchMonthData(),
    ]);
  } catch (e: unknown) {
    const error = e as Error;
    if (!import.meta.server) {
      $toast.error(error.message || 'Ошибка загрузки данных');
    }
  }
  return null;
});

const fetchData = async () => {
  loading.value = true;
  try {
    await Promise.all([
      allocationStore.fetchAllocations({
        start_date: formatDate(currentWeekStart.value),
        end_date: formatDate(currentWeekEnd.value),
      }),
      userStore.fetchUsers(),
      projectStore.projects.length ? Promise.resolve() : projectStore.fetchProjects(),
      fetchActualData(),
      fetchMonthData(),
    ]);
  } catch (e: unknown) {
    const error = e as Error;
    $toast.error(error.message || 'Ошибка загрузки данных');
  } finally {
    loading.value = false;
  }
};

const goToPreviousWeek = () => {
  currentWeekStart.value = subWeeks(currentWeekStart.value, 1);
  fetchData();
};

const goToNextWeek = () => {
  currentWeekStart.value = addWeeks(currentWeekStart.value, 1);
  fetchData();
};

const goToCurrentWeek = () => {
  currentWeekStart.value = startOfWeek(normalizeDate(new Date()), { weekStartsOn: 1 });
  fetchData();
};

const handleAllocationClick = (allocation: Allocation) => {
  if (!canEdit.value) return;
  selectedAllocation.value = allocation;
  showModal.value = true;
};

const handleCellClick = ({ user, day }: { user: User; day: Date }) => {
  if (!canEdit.value) return;
  selectedAllocation.value = null;
  prefilledUser.value = user;
  prefilledDate.value = day;
  showModal.value = true;
};

const handleSaveAllocation = async (data: CreateAllocationDto) => {
  try {
    if (selectedAllocation.value) {
      await allocationStore.updateAllocation(selectedAllocation.value.id, data);
      $toast.success('Загрузка обновлена');
    } else {
      await allocationStore.createAllocation(data);
      $toast.success('Загрузка создана');
    }
    showModal.value = false;
    selectedAllocation.value = null;
    prefilledUser.value = null;
    prefilledDate.value = null;
    await fetchData();
  } catch (e: unknown) {
    const error = e as Error;
    $toast.error(error.message || 'Ошибка сохранения');
  }
};

const handleDeleteAllocation = async (id: number) => {
  try {
    await allocationStore.deleteAllocation(id);
    $toast.success('Загрузка удалена');
    showModal.value = false;
    selectedAllocation.value = null;
    await fetchData();
  } catch (e: unknown) {
    const error = e as Error;
    $toast.error(error.message || 'Ошибка удаления');
  }
};

const handleCloseModal = () => {
  showModal.value = false;
  selectedAllocation.value = null;
  prefilledUser.value = null;
  prefilledDate.value = null;
};

onMounted(async () => {
  try {
    await userStore.fetchUsers();
  } catch (e: unknown) {
    const error = e as Error;
    $toast.error(error.message || 'Ошибка загрузки пользователей');
  }
});

watch(viewMode, (newValue) => {
  viewModeCookie.value = newValue;
});

watch(summaryPeriod, async (newValue) => {
  if (newValue === 'month' && monthData.value.length === 0) {
    await fetchMonthData();
  }
});

definePageMeta({
  middleware: ['auth', 'role'],
  name: 'planning',
  roles: [ROLES.admin, ROLES.employee],
});
</script>

<template>
  <div class="planning">
    <div class="planning__header">
      <div class="planning__title">Планирование загрузки специалистов</div>
      <div class="planning__view-toggle">
        <button
          :class="['planning__view-button', { 'planning__view-button_active': viewMode === 'plan' }]"
          @click="viewMode = 'plan'"
        >
          План
        </button>
        <button
          :class="['planning__view-button', { 'planning__view-button_active': viewMode === 'actual' }]"
          @click="viewMode = 'actual'"
        >
          Факт
        </button>
      </div>
      <div class="planning__controls">
        <button class="planning__button planning__button_prev" @click="goToPreviousWeek">
          <IconsIconArrowRight />
        </button>
        <button class="planning__button planning__button_primary" @click="goToCurrentWeek">Текущая неделя</button>
        <button class="planning__button" @click="goToNextWeek">
          <IconsIconArrowRight />
        </button>
      </div>
    </div>

    <div v-if="!loading && canEdit" class="planning__summary">
      <div class="planning__summary-header" @click="isSummaryExpanded = !isSummaryExpanded">
        <div class="planning__summary-header-content">
          <div class="planning__summary-period-toggle">
            <button
              :class="['planning__summary-period-button', { 'planning__summary-period-button_active': summaryPeriod === 'week' }]"
              @click.stop="summaryPeriod = 'week'"
            >
              Неделя
            </button>
            <button
              :class="[
                'planning__summary-period-button',
                { 'planning__summary-period-button_active': summaryPeriod === 'month' },
              ]"
              @click.stop="summaryPeriod = 'month'"
            >
              Месяц
            </button>
          </div>
          <div class="planning__summary-total">
            <div class="planning__summary-period-info">
              <span class="planning__summary-period-text">{{ periodLabel }}</span>
            </div>
            <div class="planning__summary-hours">
              <span class="planning__summary-label">Всего часов:</span>
              <span class="planning__summary-value">{{ totalHours }}ч</span>
            </div>
          </div>
        </div>
        <button class="planning__summary-toggle" :class="{ 'planning__summary-toggle_expanded': isSummaryExpanded }">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <div v-if="isSummaryExpanded" class="planning__summary-details">
        <div v-if="!detailedSummary.length" class="planning__summary-empty">За выбранный период данных нет</div>
        <div v-for="project in detailedSummary" :key="project.projectId" class="planning__summary-project">
          <div class="planning__summary-project-header">
            <span class="planning__summary-project-name">{{ project.projectName }}</span>
            <span class="planning__summary-project-total">{{ project.totalHours }}ч</span>
          </div>
          <div class="planning__summary-project-users">
            <div v-for="user in project.users" :key="user.userName" class="planning__summary-user">
              <span class="planning__summary-user-name">{{ user.userName }}</span>
              <span class="planning__summary-user-hours">{{ user.hours }}ч</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="planning__loader">
      <div class="loader" />
    </div>

    <div v-else class="planning__content">
      <ResourceTimeline
        :allocations="displayedAllocations"
        :users="userStore.users"
        :start-date="currentWeekStart"
        :end-date="currentWeekEnd"
        :readonly="!canEdit || viewMode === 'actual'"
        @allocation-click="handleAllocationClick"
        @cell-click="handleCellClick"
      />
    </div>

    <AllocationModal
      v-if="showModal"
      :allocation="selectedAllocation"
      :users="userStore.users"
      :projects="projectStore.projects"
      :prefilled-user="prefilledUser"
      :prefilled-date="prefilledDate"
      @close="handleCloseModal"
      @save="handleSaveAllocation"
      @delete="handleDeleteAllocation"
    />
  </div>
</template>

<style scoped lang="scss">
.planning {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  @include flex(cn);
  gap: 16px;
  overflow: hidden;

  &__header {
    @include flex(rn, between, a-center);
    gap: 16px;
  }

  &__title {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__view-toggle {
    @include flex(rn, a-center);
    gap: 4px;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 6px;
    padding: 4px;
  }

  &__view-button {
    padding: 6px 16px;
    border-radius: 4px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    transition: all 0.2s;
    cursor: pointer;
    @extend %text-s-medium;

    &:hover {
      color: var(--light-text-backgroung-primary);
    }

    &_active {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__controls {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__summary {
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 16px;
    @include flex(cn);
    gap: 16px;
  }

  &__summary-header {
    @include flex(rn, between, a-center);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    cursor: pointer;
    transition: background 0.2s;
    margin: -16px -16px 0 -16px;
    padding: 12px 16px;
    border-radius: 8px 8px 0 0;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__summary-header-content {
    @include flex(rn, a-center);
    gap: 16px;
    flex: 1;
  }

  &__summary-period-toggle {
    @include flex(rn);
    gap: 4px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 6px;
    padding: 4px;
  }

  &__summary-period-button {
    padding: 6px 12px;
    border-radius: 4px;
    color: var(--light-text-backgroung-primary-50);
    background: transparent;
    transition: all 0.2s;
    @extend %text-s-medium;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &_active {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);

      &:hover {
        background: var(--primary);
        color: var(--light-text-backgroung-primary);
      }
    }
  }

  &__summary-total {
    @include flex(rn, a-center);
    gap: 16px;
  }

  &__summary-period-info {
    @include flex(rn, a-center);
  }

  &__summary-period-text {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__summary-hours {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__summary-toggle {
    @include flex(center);
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: var(--primary-25);
    color: var(--primary);
    transition: all 0.3s;

    &:hover {
      background: var(--primary-50);
    }

    &_expanded {
      transform: rotate(180deg);
    }

    svg {
      width: 20px;
      height: 20px;
    }
  }

  &__summary-label {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-medium;
  }

  &__summary-value {
    color: var(--primary);
    @extend %text-l-medium;
  }

  &__summary-details {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  &__summary-empty {
    grid-column: 1 / -1;
    padding: 24px;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__summary-project {
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 6px;
    padding: 12px;
    @include flex(cn);
    gap: 8px;
  }

  &__summary-project-header {
    @include flex(rn, between, a-center);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__summary-project-name {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-bold;
  }

  &__summary-project-total {
    color: var(--primary);
    @extend %text-s-bold;
  }

  &__summary-project-users {
    @include flex(cn);
    gap: 6px;
  }

  &__summary-user {
    @include flex(rn, between, a-center);
    padding: 4px 8px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 4px;
  }

  &__summary-user-name {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__summary-user-hours {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-medium;
  }

  &__button {
    padding: 8px 16px;
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    gap: 8px;
    transition: all 0.2s;
    cursor: pointer;
    @extend %text-s-medium;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      border-color: var(--light-text-backgroung-primary-25);
    }

    &_primary {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--light-text-backgroung-primary);

      &:hover {
        background: var(--primary-hover);
        border-color: var(--primary-hover);
      }
    }

    &_prev {
      svg {
        transform: rotate(180deg);
      }
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__loader {
    flex: 1;
    @include flex(center);
  }

  &__content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
}

.loader {
  width: 40px;
  height: 40px;
  border: 4px solid var(--primary-25);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
