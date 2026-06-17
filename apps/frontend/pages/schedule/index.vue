<script setup lang="ts">
import { startOfWeek, endOfWeek, addWeeks, subWeeks, format, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useWorkScheduleStore } from '~/stores/workScheduleStore';
import { useUserStore } from '~/stores/userStore';
import type { WorkSchedule, CreateWorkScheduleDto } from '~/types/work-schedule';
import type { User } from '~/types/user';
import { ROLES } from '~/types/user';

definePageMeta({
  middleware: ['auth', 'role'],
  name: 'schedule',
  roles: [ROLES.admin, ROLES.employee],
});

const store = useWorkScheduleStore();
const userStore = useUserStore();
const { $toast } = useNuxtApp();

const normalizeDate = (d: Date) => {
  const n = new Date(d);
  n.setHours(12, 0, 0, 0);
  return n;
};
const formatDate = (d: Date) => format(d, 'yyyy-MM-dd');

const currentWeekStart = ref(startOfWeek(normalizeDate(new Date()), { weekStartsOn: 1 }));
const currentWeekEnd = computed(() => endOfWeek(currentWeekStart.value, { weekStartsOn: 1 }));

const days = computed(() => eachDayOfInterval({ start: currentWeekStart.value, end: currentWeekEnd.value }));

const weekLabel = computed(() => {
  const ws = currentWeekStart.value;
  const we = currentWeekEnd.value;
  const start = format(ws, 'd MMM', { locale: ru });
  const end = format(we, 'd MMM yyyy', { locale: ru });
  return `${start} — ${end}`;
});

const monthName = computed(() => format(currentWeekStart.value, 'MMM', { locale: ru }));

const isAdmin = computed(() => userStore.user?.role === ROLES.admin);
const currentUserId = computed(() => userStore.user?.id ?? null);

const showModal = ref(false);
const selectedSchedule = ref<WorkSchedule | null>(null);
const prefilledUserId = ref<number | null>(null);
const prefilledDate = ref<string | null>(null);

const compareUsers = (left: User, right: User) => {
  if (left.id === currentUserId.value) return -1;
  if (right.id === currentUserId.value) return 1;

  const leftName = `${left.first_name} ${left.last_name}`.trim();
  const rightName = `${right.first_name} ${right.last_name}`.trim();

  return leftName.localeCompare(rightName, 'ru');
};

const displayedUsers = computed(() => {
  return [...store.visibleUsers].sort(compareUsers);
});

const canManageScheduleForUser = (userId: number) => isAdmin.value || currentUserId.value === userId;

const scheduleIndex = computed(() => {
  const idx = new Map<number, Map<string, WorkSchedule[]>>();
  for (const ws of store.schedules) {
    if (!idx.has(ws.user_id)) idx.set(ws.user_id, new Map());
    const byDate = idx.get(ws.user_id)!;
    if (!byDate.has(ws.work_date)) byDate.set(ws.work_date, []);
    byDate.get(ws.work_date)!.push(ws);
  }
  return idx;
});

const getSlotsForCell = (userId: number, date: Date): WorkSchedule[] =>
  scheduleIndex.value.get(userId)?.get(formatDate(date)) ?? [];

const weeklyHours = computed(() => {
  const map = new Map<number, number>();
  for (const ws of store.schedules) {
    map.set(ws.user_id, (map.get(ws.user_id) ?? 0) + Number(ws.hours));
  }
  return map;
});

const monthlyHours = computed(() => {
  const map = new Map<number, number>();
  const monthPrefix = format(currentWeekStart.value, 'yyyy-MM');
  for (const ws of store.monthlySchedules) {
    if (ws.work_date.startsWith(monthPrefix)) {
      map.set(ws.user_id, (map.get(ws.user_id) ?? 0) + Number(ws.hours));
    }
  }
  return map;
});


const doFetch = async () => {
  try {
    const monthStart = startOfMonth(currentWeekStart.value);
    const monthEnd = endOfMonth(currentWeekEnd.value);
    await Promise.all([
      store.fetchVisibleUsers(),
      store.fetchSchedules({
        start_date: formatDate(currentWeekStart.value),
        end_date: formatDate(currentWeekEnd.value),
      }),
      store.fetchMonthlySchedules(formatDate(monthStart), formatDate(monthEnd)),
    ]);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
  return true;
};

const openCreate = (userId: number, date: Date) => {
  if (!canManageScheduleForUser(userId)) return;

  selectedSchedule.value = null;
  prefilledUserId.value = userId;
  prefilledDate.value = formatDate(date);
  showModal.value = true;
};

const openEdit = (ws: WorkSchedule) => {
  if (!canManageScheduleForUser(ws.user_id)) return;

  selectedSchedule.value = ws;
  prefilledUserId.value = null;
  prefilledDate.value = null;
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  selectedSchedule.value = null;
  prefilledUserId.value = null;
  prefilledDate.value = null;
};

const handleSave = async (data: CreateWorkScheduleDto) => {
  try {
    if (selectedSchedule.value) {
      await store.updateSchedule(selectedSchedule.value.id, data);
      $toast.success('Слот обновлён');
    } else {
      await store.createSchedule(data);
      $toast.success('Слот добавлен');
    }
    closeModal();
    await fetchData();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const handleDelete = async (id: number) => {
  try {
    await store.deleteSchedule(id);
    $toast.success('Слот удалён');
    closeModal();
    await fetchData();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const { status, refresh } = await useAsyncData('schedule', () => doFetch());
const loading = computed(() => status.value === 'pending');

const fetchData = () => refresh();

const goToPrev = () => {
  currentWeekStart.value = subWeeks(currentWeekStart.value, 1);
  fetchData();
};
const goToNext = () => {
  currentWeekStart.value = addWeeks(currentWeekStart.value, 1);
  fetchData();
};
const goToCurrent = () => {
  currentWeekStart.value = startOfWeek(normalizeDate(new Date()), { weekStartsOn: 1 });
  fetchData();
};

const isToday = (date: Date) => {
  const today = normalizeDate(new Date());
  return formatDate(date) === formatDate(today);
};

const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
</script>

<template>
  <div class="schedule">
    <div class="schedule__header">
      <h1 class="schedule__title">График работы</h1>
      <div class="schedule__controls">
        <button class="schedule__btn schedule__btn_icon schedule__btn_prev" @click="goToPrev">
          <IconsIconArrowRight />
        </button>
        <span class="schedule__week-label">{{ weekLabel }}</span>
        <button class="schedule__btn schedule__btn_primary" @click="goToCurrent">Текущая неделя</button>
        <button class="schedule__btn schedule__btn_icon" @click="goToNext">
          <IconsIconArrowRight />
        </button>
      </div>
    </div>

    <div class="schedule__grid-wrap">
      <div v-if="loading" class="schedule__loader">
        <div class="schedule__spinner"></div>
      </div>

      <div v-else class="schedule__grid">
        <div class="schedule__corner">Сотрудник</div>
        <div
          v-for="day in days"
          :key="day.toISOString()"
          :class="[
            'schedule__day-header',
            { 'schedule__day-header_today': isToday(day) },
            { 'schedule__day-header_weekend': isWeekend(day) },
          ]"
        >
          <span class="schedule__day-name">{{ format(day, 'EEE', { locale: ru }) }}</span>
          <span class="schedule__day-num">{{ format(day, 'd') }}</span>
          <span class="schedule__day-month">{{ format(day, 'MMM', { locale: ru }) }}</span>
        </div>

        <template v-for="user in displayedUsers" :key="user.id">
          <div class="schedule__user-cell">
            <div class="schedule__avatar">
              <img
                v-if="user.photo_url"
                :src="user.photo_url"
                :alt="user.first_name"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span v-else>{{ user.first_name[0] }}{{ user.last_name[0] }}</span>
            </div>
            <div class="schedule__user-info">
              <span class="schedule__user-name" :title="`${user.first_name} ${user.last_name}`">{{ user.first_name }} {{ user.last_name }}</span>
              <div class="schedule__hours-row">
                <span class="schedule__hours-label">Нед.</span>
                <span class="schedule__hours-value">{{ weeklyHours.get(user.id) ?? 0 }} ч</span>
                <span class="schedule__hours-sep">/</span>
                <span class="schedule__hours-label">{{ monthName }}</span>
                <span class="schedule__hours-value">{{ monthlyHours.get(user.id) ?? 0 }} ч</span>
              </div>
            </div>
          </div>

          <div
            v-for="day in days"
            :key="day.toISOString()"
            :class="[
              'schedule__cell',
              { schedule__cell_weekend: isWeekend(day) },
              { schedule__cell_empty: getSlotsForCell(user.id, day).length === 0 },
              { schedule__cell_readonly: !canManageScheduleForUser(user.id) },
            ]"
            @click="openCreate(user.id, day)"
          >
            <template v-if="getSlotsForCell(user.id, day).length > 0">
              <div
                v-for="slot in getSlotsForCell(user.id, day)"
                :key="slot.id"
                :class="['schedule__badge', slot.is_day_off ? 'schedule__badge_off' : 'schedule__badge_work']"
                @click.stop="openEdit(slot)"
              >
                <template v-if="slot.is_day_off">
                  <span class="schedule__badge-off">Выходной</span>
                </template>
                <template v-else>
                  <span v-if="slot.start_time && slot.end_time" class="schedule__badge-time">
                    {{ slot.start_time.slice(0, 5) }}–{{ slot.end_time.slice(0, 5) }}
                  </span>
                  <span class="schedule__badge-hours">{{ Number(slot.hours) }} ч</span>
                </template>
                <span v-if="slot.notes" class="schedule__badge-notes">{{ slot.notes }}</span>
              </div>
              <button
                v-if="canManageScheduleForUser(user.id)"
                class="schedule__add-slot"
                title="Добавить слот"
                @click.stop="openCreate(user.id, day)"
              >
                +
              </button>
            </template>
            <div v-else-if="canManageScheduleForUser(user.id)" class="schedule__cell-add">+</div>
          </div>
        </template>
      </div>
    </div>

    <WorkScheduleModal
      v-if="showModal"
      :schedule="selectedSchedule"
      :users="displayedUsers"
      :is-admin="isAdmin"
      :prefilled-user-id="prefilledUserId"
      :prefilled-date="prefilledDate"
      :existing-slots="prefilledUserId && prefilledDate ? getSlotsForCell(prefilledUserId, new Date(prefilledDate)) : selectedSchedule ? getSlotsForCell(selectedSchedule.user_id, new Date(selectedSchedule.work_date)) : []"
      @close="closeModal"
      @save="handleSave"
      @delete="handleDelete"
    />
  </div>
</template>

<style scoped lang="scss">
.schedule {
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
    flex-shrink: 0;
  }

  &__title {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__controls {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__week-label {
    padding: 0 4px;
    white-space: nowrap;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @include flex(rn, a-center);
    gap: 6px;
    @extend %text-s-medium;
    transition:
      background 0.15s,
      border-color 0.15s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
      border-color: var(--light-text-backgroung-primary-25);
    }

    &_icon {
      width: 36px;
      padding: 0;
      justify-content: center;

      svg {
        width: 16px;
        height: 16px;
      }
    }

    &_prev svg {
      transform: rotate(180deg);
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
  }

  &__grid-wrap {
    flex: 1;
    overflow: auto;
    min-height: 0;
    border-radius: 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);
  }

  &__grid {
    display: grid;
    grid-template-columns: 210px repeat(7, 1fr);
    min-width: 960px;
  }

  &__corner {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 10;
    background: var(--dark-text-background-primary);
    padding: 12px 16px;
    color: var(--light-text-backgroung-primary-50);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, a-center);
    @extend %text-xs-medium;
  }

  &__day-header {
    position: sticky;
    top: 0;
    z-index: 9;
    background: var(--dark-text-background-primary);
    padding: 10px 12px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(cn, a-center);
    gap: 2px;

    &:last-child {
      border-right: none;
    }

    &_weekend {
      background: var(--light-text-backgroung-primary-5);
    }

    &_today &__day-name,
    &_today &__day-num {
      color: var(--primary);
    }
  }

  &__day-name {
    color: var(--light-text-backgroung-primary-50);
    text-transform: capitalize;
    @extend %text-xs-medium;
  }

  &__day-num {
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;

    .schedule__day-header_today & {
      color: var(--primary);
    }
  }

  &__day-month {
    color: var(--light-text-backgroung-primary-25);
    @extend %text-xs-regular;
  }

  &__user-cell {
    position: sticky;
    left: 0;
    z-index: 8;
    background: var(--dark-text-background-primary);
    padding: 10px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, a-center);
    gap: 10px;
    min-height: 56px;
  }

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    flex-shrink: 0;
    @include flex(center);
    color: var(--light-text-backgroung-primary);
    background: var(--primary);
    overflow: hidden;
    @extend %text-xs-medium;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__user-info {
    @include flex(cn);
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  &__user-name {
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    @extend %text-s-medium;
  }

  &__hours-row {
    @include flex(rn, a-center);
    gap: 4px;
  }

  &__hours-label {
    color: var(--light-text-backgroung-primary-25);
    text-transform: uppercase;
    white-space: nowrap;
    @extend %text-xs-medium;
  }

  &__hours-sep {
    color: var(--light-text-backgroung-primary-10);
    @extend %text-xs-regular;
  }

  &__hours-value {
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;
    @extend %text-xs-medium;
  }

  &__cell {
    padding: 8px 6px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    cursor: pointer;
    @include flex(cn);
    gap: 4px;
    min-height: 56px;
    position: relative;
    transition: background 0.15s;

    &:last-child {
      border-right: none;
    }
    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
    &_weekend {
      background: var(--light-text-backgroung-primary-5);
    }
    &_weekend:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_readonly {
      cursor: default;

      &:hover {
        background: transparent;
      }
    }
  }

  &__cell_readonly.schedule__cell_weekend:hover {
    background: var(--light-text-backgroung-primary-5);
  }

  &__cell-add {
    position: absolute;
    inset: 0;
    @include flex(center);
    color: var(--primary-50);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
    @extend %display-xs-regular;
  }

  &__cell_empty:hover &__cell-add {
    opacity: 1;
  }

  &__add-slot {
    align-self: flex-start;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: 1px dashed var(--primary-50);
    background: transparent;
    color: var(--primary);
    line-height: 1;
    cursor: pointer;
    @include flex(center);
    margin-top: 2px;
    opacity: 0;
    transition:
      opacity 0.15s,
      background 0.15s;
    @extend %text-s-medium;

    &:hover {
      background: var(--primary-25);
      color: var(--primary);
    }
  }

  &__cell:hover &__add-slot {
    opacity: 1;
  }

  &__badge {
    border-radius: 6px;
    padding: 4px 7px;
    @include flex(cn);
    gap: 2px;
    transition: border-color 0.15s;
    cursor: pointer;

    &_work {
      background: var(--primary-25);
      border: 1px solid var(--primary-50);
      &:hover {
        border-color: var(--primary);
      }
    }

    &_off {
      background: var(--light-text-backgroung-primary-5);
      border: 1px solid var(--light-text-backgroung-primary-10);
      &:hover {
        border-color: var(--light-text-backgroung-primary-25);
      }
    }
  }

  &__badge-time {
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-medium;
  }

  &__badge-hours {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__badge-off {
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-medium;
  }

  &__badge-notes {
    color: var(--light-text-backgroung-primary-25);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    @extend %text-xs-regular;
  }

  &__loader {
    @include flex(center);
    height: 200px;
  }

  &__spinner {
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
}
</style>
