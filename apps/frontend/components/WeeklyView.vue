<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { addDays, subDays, format, parseISO, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { WeeklyCard, WeeklyColumn } from '~/types/task';
import { TaskType } from '~/types/task';
import { TASK_STATUSES } from '~/constants/task.constants';
import IconRecurrence from '~/components/Icons/IconRecurrence.vue';

const taskStore = useTaskStore();
const router = useRouter();
const { $toast } = useNuxtApp();

const currentWeekStart = ref<string>('');

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;

const columns = computed<WeeklyColumn[]>(() => taskStore.weeklyTasks?.columns ?? []);

const isCardDone = (card: WeeklyCard) =>
  card.completed || (!card.recurrence_days?.length && card.status === TASK_STATUSES.closed);

const weekLabel = computed(() => {
  if (!taskStore.weeklyTasks) return '';
  const start = parseISO(taskStore.weeklyTasks.week_start);
  const end = addDays(start, 6);
  return `${format(start, 'd MMM', { locale: ru })} – ${format(end, 'd MMM yyyy', { locale: ru })}`;
});

const fetchWeek = async (weekStart?: string) => {
  try {
    await taskStore.fetchWeeklyTasks(weekStart);
    if (taskStore.weeklyTasks) {
      currentWeekStart.value = taskStore.weeklyTasks.week_start;
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const prevWeek = () => {
  const prev = format(subDays(parseISO(currentWeekStart.value), 7), 'yyyy-MM-dd');
  fetchWeek(prev);
};

const nextWeek = () => {
  const next = format(addDays(parseISO(currentWeekStart.value), 7), 'yyyy-MM-dd');
  fetchWeek(next);
};

const goToCurrentWeek = () => fetchWeek();

const toggleCompletion = async (taskId: number, date: string, completed: boolean) => {
  try {
    if (completed) {
      await taskStore.uncompleteRecurringTask(taskId, date);
    } else {
      await taskStore.completeRecurringTask(taskId, date);
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const openTask = (taskId: number, date: string, isRecurring: boolean) => {
  router.push({ query: isRecurring ? { 'task-id': taskId, 'task-date': date } : { 'task-id': taskId } });
  taskStore.currentTaskId = taskId;
  taskStore.currentTaskDate = isRecurring ? date : null;
};

await callOnce('weekly-tasks-init', async () => {
  if (taskStore.weeklyTasks) {
    currentWeekStart.value = taskStore.weeklyTasks.week_start;
    return;
  }
  const data = await taskStore.fetchWeeklyTasks();
  if (data) currentWeekStart.value = data.week_start;
});

onMounted(() => {
  if (taskStore.weeklyTasks) {
    currentWeekStart.value = taskStore.weeklyTasks.week_start;
  }
});
</script>

<template>
  <div class="weekly-view">
    <div class="weekly-view__nav">
      <button class="weekly-view__nav-btn" @click="prevWeek">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <span class="weekly-view__week-label">{{ weekLabel }}</span>
      <button class="weekly-view__nav-btn" @click="nextWeek">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="weekly-view__today-btn" @click="goToCurrentWeek">Текущая неделя</button>
    </div>

    <div class="weekly-view__columns">
      <div v-for="column in columns" :key="column.date" class="weekly-view__column">
        <div class="weekly-view__column-header">
          <span
            class="weekly-view__column-header_dot"
            :class="isToday(parseISO(column.date)) ? 'weekly-view__column-header_today' : 'weekly-view__column-header_default'"
          ></span>
          <span class="weekly-view__column-title"
            >{{ DAY_LABELS[column.dayOfWeek] }} {{ format(parseISO(column.date), 'd MMM', { locale: ru }) }}</span
          >
          <span v-if="column.cards.length" class="weekly-view__column-count">{{ column.cards.length }}</span>
        </div>

        <div class="weekly-view__cards">
          <div
            v-for="card in column.cards"
            :key="card.id"
            class="weekly-view__card"
            :class="{ 'weekly-view__card_done': isCardDone(card) }"
            @click="openTask(card.id, column.date, !!card.recurrence_days?.length)"
          >
            <div class="weekly-view__card-header">
              <div class="weekly-view__card-project">{{ card.project?.name }}</div>
              <div class="weekly-view__card-header-right">
                <img
                  v-if="card.responsible?.photo_url"
                  :src="card.responsible.photo_url"
                  class="weekly-view__card-avatar"
                  @error="($event.target as HTMLImageElement).src = '/avatar-placeholder.svg'"
                />
                <IconRecurrence v-if="card.recurrence_days?.length" class="weekly-view__card-repeat-icon" />
              </div>
            </div>

            <div class="weekly-view__card-title">
              <span
                class="weekly-view__card-type"
                :class="card.taskType === TaskType.USER_STORY ? 'weekly-view__card-type_story' : 'weekly-view__card-type_task'"
              >
                <IconsIconTypeUserStory v-if="card.taskType === TaskType.USER_STORY" />
                <IconsIconTypeTask v-else />
              </span>
              <span>{{ card.title }}</span>
            </div>

            <div v-if="card.description" class="weekly-view__card-description">{{ card.description }}</div>

            <div v-if="card.story_points != null" class="weekly-view__card-sp">{{ card.story_points }} SP</div>

            <button
              v-if="card.recurrence_days?.length"
              class="weekly-view__done-btn"
              :class="{ 'weekly-view__done-btn_active': card.completed }"
              @click.stop="toggleCompletion(card.id, column.date, card.completed)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {{ card.completed ? 'Выполнено' : 'Отметить' }}
            </button>
          </div>

          <div v-if="!column.cards.length" class="weekly-view__column-empty">—</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.weekly-view {
  width: 100%;
  height: 100%;
  @include flex(cn);
  gap: 16px;

  &__nav {
    @include flex(a-center);
    gap: 8px;
  }

  &__nav-btn {
    @include flex(center);
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__week-label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    min-width: 160px;
    text-align: center;
  }

  &__today-btn {
    @extend %text-s-regular;
    margin-left: 8px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
  }

  &__columns {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    width: 100%;
    overflow-x: auto;
    height: 100%;
  }

  &__column {
    position: relative;
    flex: 0 0 260px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0 8px;
    gap: 8px;
    height: 100%;
    border-right: 1px solid var(--light-text-backgroung-primary-10);

    &:first-child {
      padding-left: 0;
    }

    &:last-child {
      padding-right: 0;
      border-right: none;
    }
  }

  &__column-header {
    @include flex(a-center);
    gap: 6px;
    color: var(--light-text-backgroung-primary);

    &_dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    &_today {
      background: var(--primary);
    }

    &_default {
      background: var(--light-text-backgroung-primary-25);
    }
  }

  &__column-title {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__column-count {
    @extend %text-xs-medium;
    color: var(--light-text-backgroung-primary-50);
    background: var(--light-text-backgroung-primary-10);
    border-radius: 10px;
    padding: 1px 7px;
    min-width: 20px;
    text-align: center;
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    flex: 1;
  }

  &__card {
    position: relative;
    cursor: pointer;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px;
    gap: 6px;
    width: 100%;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    box-shadow: 0 2px 4px 0 var(--black-10);
    backdrop-filter: blur(12px);
    transition: background 0.15s;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &_done {
      opacity: 0.5;

      .weekly-view__card-title span:last-child {
        text-decoration: line-through;
      }
    }
  }

  &__card-header {
    display: flex;
    justify-content: space-between;
    width: 100%;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__card-project {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__card-header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__card-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  &__card-repeat-icon {
    color: var(--primary);
    opacity: 0.6;
    flex-shrink: 0;
  }

  &__card-title {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    width: 100%;
    word-break: break-word;
    display: flex;
    align-items: flex-start;
    gap: 5px;

    & > span:last-child {
      flex: 1;
      min-width: 0;
    }
  }

  &__card-type {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    padding: 1px;

    &_task {
      border: 1px solid var(--primary);
      background: var(--primary-50);
    }

    &_story {
      border: 1px solid var(--accent);
      background: var(--accent-50);
    }
  }

  &__card-description {
    width: 100%;
    color: var(--light-text-backgroung-primary-50);
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    @extend %text-xs-regular;
  }

  &__card-sp {
    @extend %text-xs-medium;
    color: var(--primary);
    background: var(--primary-25);
    border-radius: 4px;
    padding: 1px 6px;
    align-self: flex-start;
  }

  &__done-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px 3px 7px;
    border-radius: 5px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @extend %text-xs-regular;
    transition: all 0.15s;

    svg {
      opacity: 0.35;
      transition: opacity 0.15s;
    }

    &:hover {
      border-color: var(--primary);
      color: var(--primary);

      svg {
        opacity: 1;
      }
    }

    &_active {
      border-color: var(--primary);
      background: var(--primary-25);
      color: var(--primary);
      font-weight: 600;

      svg {
        opacity: 1;
      }
    }
  }

  &__column-empty {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-25);
    padding: 4px 0;
  }
}
</style>
