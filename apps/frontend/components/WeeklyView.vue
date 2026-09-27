<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { addDays, subDays, format, parseISO, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { WeeklyCard, WeeklyColumn } from '~/types/task';
import { TASK_STATUSES } from '~/constants/task.constants';
import IconRecurrence from '~/components/Icons/IconRecurrence.vue';
import { Check, ChevronLeft, ChevronRight } from '@lucide/vue';

const taskStore = useTaskStore();
const router = useRouter();
const { $toast } = useNuxtApp();

const currentWeekStart = ref<string>('');
const isLoading = ref(false);
const { isDragging: isBoardDragging, onPointerDown, onPointerMove, onPointerEnd } = useHorizontalDragScroll();
const draggedCard = ref<WeeklyCard | null>(null);
const draggedFromColumn = ref<number | null>(null);
const draggedFromIndex = ref<number | null>(null);
const hoveredColumn = ref<number | null>(null);

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
  isLoading.value = true;
  try {
    await taskStore.fetchWeeklyTasks(weekStart);
    if (taskStore.weeklyTasks) {
      currentWeekStart.value = taskStore.weeklyTasks.week_start;
    }
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isLoading.value = false;
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

const resetDrag = () => {
  draggedCard.value = null;
  draggedFromColumn.value = null;
  draggedFromIndex.value = null;
  hoveredColumn.value = null;
};

const onDragStart = (columnIndex: number, cardIndex: number, card: WeeklyCard, event: DragEvent) => {
  draggedCard.value = card;
  draggedFromColumn.value = columnIndex;
  draggedFromIndex.value = cardIndex;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(card.id));
  }
};

const onDragOverColumn = (columnIndex: number, event: DragEvent) => {
  event.preventDefault();
  if (!draggedCard.value) return;
  hoveredColumn.value = draggedFromColumn.value === columnIndex ? null : columnIndex;
};

const onDragLeaveColumn = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as Node | null;
  if (relatedTarget && target.contains(relatedTarget)) return;
  hoveredColumn.value = null;
};

const refreshAfterDragError = async (error: unknown) => {
  $toast.error(getErrorMessage(error));
  await fetchWeek(currentWeekStart.value || undefined);
};

const swapCards = async (columnIndex: number, targetIndex: number) => {
  const sourceIndex = draggedFromIndex.value;
  if (sourceIndex === null || sourceIndex === targetIndex) return;

  const cards = columns.value[columnIndex]?.cards;
  const sourceCard = cards?.[sourceIndex];
  const targetCard = cards?.[targetIndex];
  if (!cards || !sourceCard || !targetCard) return;

  const sourcePriority = sourceCard.priority;
  sourceCard.priority = targetCard.priority;
  targetCard.priority = sourcePriority;
  cards.splice(sourceIndex, 1, targetCard);
  cards.splice(targetIndex, 1, sourceCard);

  try {
    await taskStore.swapPriorityTask([sourceCard.id, targetCard.id]);
    taskStore.invalidateTasksPage();
  } catch (error) {
    await refreshAfterDragError(error);
  }
};

const moveCardToColumn = async (targetColumnIndex: number) => {
  const sourceColumnIndex = draggedFromColumn.value;
  const sourceCardIndex = draggedFromIndex.value;
  const card = draggedCard.value;
  if (sourceColumnIndex === null || sourceCardIndex === null || !card || sourceColumnIndex === targetColumnIndex) return;

  const sourceColumn = columns.value[sourceColumnIndex];
  const targetColumn = columns.value[targetColumnIndex];
  if (!sourceColumn || !targetColumn) return;

  sourceColumn.cards.splice(sourceCardIndex, 1);
  const existingTargetCard = targetColumn.cards.find((item) => item.id === card.id);
  if (!existingTargetCard) {
    const insertIndex = targetColumn.cards.findIndex((item) => item.priority < card.priority);
    targetColumn.cards.splice(insertIndex === -1 ? targetColumn.cards.length : insertIndex, 0, card);
  }

  try {
    if (card.recurrence_days?.length) {
      const nextRecurrenceDays = [
        ...new Set(card.recurrence_days.filter((day) => day !== sourceColumn.dayOfWeek).concat(targetColumn.dayOfWeek)),
      ].sort((a, b) => a - b);
      for (const column of columns.value) {
        for (const item of column.cards) {
          if (item.id === card.id) item.recurrence_days = nextRecurrenceDays;
        }
      }
      await taskStore.updateTask(card.id, { recurrence_days: nextRecurrenceDays });
      if (card.completed) {
        await taskStore.uncompleteRecurringTask(card.id, sourceColumn.date);
        await taskStore.completeRecurringTask(card.id, targetColumn.date);
      }
    } else {
      await taskStore.updateTask(card.id, { planned_date: targetColumn.date });
    }
    if (sourceColumn.date === format(new Date(), 'yyyy-MM-dd') || targetColumn.date === format(new Date(), 'yyyy-MM-dd')) {
      await taskStore.fetchMyTodayTasksCount();
    }
    taskStore.invalidateTasksPage();
  } catch (error) {
    await refreshAfterDragError(error);
  }
};

const onDropToColumn = async (columnIndex: number, event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  await moveCardToColumn(columnIndex);
  resetDrag();
};

const onDropToCard = async (columnIndex: number, cardIndex: number, event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedCard.value) return;

  if (draggedFromColumn.value === columnIndex) await swapCards(columnIndex, cardIndex);
  else await moveCardToColumn(columnIndex);
  resetDrag();
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
    <TasksViewSkeleton v-if="isLoading" view="weekly" />
    <template v-else>
      <div class="weekly-view__nav">
        <button
          class="weekly-view__nav-btn"
          type="button"
          aria-label="Предыдущая неделя"
          title="Предыдущая неделя"
          @click="prevWeek"
        >
          <ChevronLeft :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <span class="weekly-view__week-label">{{ weekLabel }}</span>
        <button
          class="weekly-view__nav-btn"
          type="button"
          aria-label="Следующая неделя"
          title="Следующая неделя"
          @click="nextWeek"
        >
          <ChevronRight :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <button class="weekly-view__today-btn" type="button" @click="goToCurrentWeek">Текущая неделя</button>
      </div>

      <div
        class="weekly-view__columns"
        :class="{ 'weekly-view__columns_dragging': isBoardDragging }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
      >
        <div
          v-for="(column, columnIndex) in columns"
          :key="column.date"
          class="weekly-view__column"
          :class="{ 'weekly-view__column_drag-over': hoveredColumn === columnIndex }"
          @dragover="onDragOverColumn(columnIndex, $event)"
          @dragleave="onDragLeaveColumn"
          @drop="onDropToColumn(columnIndex, $event)"
        >
          <div class="weekly-view__column-header">
            <span
              class="weekly-view__column-header_dot"
              :class="isToday(parseISO(column.date)) ? 'weekly-view__column-header_today' : 'weekly-view__column-header_default'"
            ></span>
            <span class="weekly-view__column-title"
              >{{ DAY_LABELS[column.dayOfWeek] }} {{ format(parseISO(column.date), 'd MMM', { locale: ru }) }}</span
            >
            <span class="weekly-view__column-count">{{ column.cards.length }}</span>
          </div>

          <div class="weekly-view__cards">
            <BaseKanbanCard
              v-for="(card, cardIndex) in column.cards"
              :key="card.id"
              as="div"
              draggable="true"
              role="button"
              tabindex="0"
              :class="{ 'weekly-view__card_hidden': draggedCard?.id === card.id && draggedFromColumn === columnIndex }"
              :muted="isCardDone(card)"
              @click="openTask(card.id, column.date, !!card.recurrence_days?.length)"
              @keydown.enter.prevent="openTask(card.id, column.date, !!card.recurrence_days?.length)"
              @keydown.space.prevent="openTask(card.id, column.date, !!card.recurrence_days?.length)"
              @dragstart="onDragStart(columnIndex, cardIndex, card, $event)"
              @dragover.prevent
              @drop="onDropToCard(columnIndex, cardIndex, $event)"
              @dragend="resetDrag"
            >
              <template #header>
                <div class="weekly-view__card-project" :title="card.project?.name">{{ card.project?.name }}</div>
                <TaskCode :id="card.id" />
              </template>
              <template #title>
                <TaskTypeBadge :task-type="card.taskType" />
                {{ card.title }}
              </template>
              <template v-if="card.description" #description>{{ card.description }}</template>
              <template v-if="card.story_points != null || card.responsible?.photo_url || card.recurrence_days?.length" #footer>
                <div v-if="card.story_points != null" class="weekly-view__card-sp">{{ card.story_points }} SP</div>
                <button
                  v-if="card.recurrence_days?.length"
                  class="weekly-view__done-btn"
                  :class="{ 'weekly-view__done-btn_active': card.completed }"
                  type="button"
                  @click.stop="toggleCompletion(card.id, column.date, card.completed)"
                >
                  <Check :size="14" :stroke-width="2" aria-hidden="true" />
                  {{ card.completed ? 'Выполнено' : 'Отметить' }}
                </button>
                <div class="weekly-view__card-meta">
                  <IconRecurrence v-if="card.recurrence_days?.length" class="weekly-view__card-repeat-icon" />
                  <img
                    v-if="card.responsible?.photo_url"
                    :src="card.responsible.photo_url"
                    class="weekly-view__card-avatar"
                    alt=""
                    @error="($event.target as HTMLImageElement).src = '/avatar-placeholder.svg'"
                  />
                </div>
              </template>
            </BaseKanbanCard>

            <div v-if="!column.cards.length" class="weekly-view__column-empty">—</div>
          </div>
        </div>
      </div>
    </template>
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
    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
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

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
  }

  &__columns {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    width: 100%;
    overflow-x: auto;
    cursor: grab;
    height: 100%;

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
    flex: 0 0 306px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0 8px;
    gap: 8px;
    height: 100%;
    width: 306px;
    min-width: 306px;
    max-width: 306px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    transition: background 0.15s;

    &:first-child {
      padding-left: 0;
    }

    &:last-child {
      padding-right: 0;
      border-right: none;
    }

    &_drag-over {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__column-header {
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    @include flex(a-center);
    gap: 8px;
    color: var(--light-text-backgroung-primary);
    @extend %text-l-regular;

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
    min-width: 0;
    overflow-wrap: anywhere;
    @extend %text-l-regular;
    color: var(--light-text-backgroung-primary);
  }

  &__column-count {
    @extend %text-xs-light;
    color: var(--light-text-backgroung-primary-50);
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    min-width: 0;
    flex: 1;
  }

  &__card-project {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__card_hidden {
    opacity: 0.2;
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

  &__card-meta {
    margin-left: auto;
    gap: 4px;
    @include flex(a-center);
  }

  &__card-sp {
    @extend %text-xs-medium;
    color: var(--primary);
    background: var(--primary-10);
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

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
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
