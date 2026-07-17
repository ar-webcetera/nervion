<script setup lang="ts">
import type { PropType } from 'vue';
import { TASK_STATUSES } from '~/constants/task.constants';
import { TaskType } from '~/enums/task.enums';

const { resolveAwsUrl } = useResolveUrl();

const props = defineProps({
  columns: {
    type: Array as PropType<KanbanColumn[]>,
    default: () => [
      {
        id: 1,
        title: 'К выполнению',
        status: TASK_STATUSES.to_do,
        cards: [
          {
            id: 1,
            title: 'Card title',
            taskType: TaskType.TASK,
            description: 'A description of a task.',
            users: ['https://i.pravatar.cc/40?img=1', 'https://i.pravatar.cc/40?img=2'],
            priority: 1,
          },
        ],
      },
      {
        id: 2,
        title: 'Выполняется',
        status: TASK_STATUSES.in_progress,
        cards: [
          {
            id: 2,
            title: 'Card title',
            taskType: TaskType.TASK,
            description: 'A description of a task.',
            users: ['https://i.pravatar.cc/40?img=3', 'https://i.pravatar.cc/40?img=4'],
            priority: 2,
          },
          {
            id: 3,
            title: 'Card title',
            taskType: TaskType.TASK,
            description: 'A description of a task.',
            users: ['https://i.pravatar.cc/40?img=3', 'https://i.pravatar.cc/40?img=4'],
            priority: 2,
          },
        ],
      },
      {
        id: 3,
        title: 'На ревью',
        status: TASK_STATUSES.in_review,
        cards: [
          {
            id: 3,
            title: 'Card title',
            taskType: TaskType.TASK,
            description: 'A description of a task.',
            users: ['https://i.pravatar.cc/40?img=5', 'https://i.pravatar.cc/40?img=6'],
            priority: 3,
          },
        ],
      },
    ],
  },
});

const emit = defineEmits(['click-to-card', 'swap-priority-task', 'update-task', 'toggle-collapse', 'load-more']);

const columns = computed<KanbanColumn[]>(() => props.columns);

const loadingColumns = ref<Set<string>>(new Set());
const sentinelEls = new Map<number, HTMLElement>();
let cardsObserver: IntersectionObserver | null = null;

const triggerLoadMore = (colIndex: number) => {
  const column = columns.value[colIndex];
  if (!column) return;
  const loaded = column.cards.length;
  const total = column.total ?? loaded;
  if (loaded >= total || loadingColumns.value.has(column.status)) return;

  loadingColumns.value = new Set(loadingColumns.value).add(column.status);
  emit('load-more', {
    status: column.status,
    offset: loaded,
    done: () => {
      const next = new Set(loadingColumns.value);
      next.delete(column.status);
      loadingColumns.value = next;
    },
  });
};

const setSentinel = (el: unknown, colIndex: number) => {
  const prev = sentinelEls.get(colIndex);
  if (prev && cardsObserver) cardsObserver.unobserve(prev);
  if (el instanceof HTMLElement) {
    el.dataset.colIndex = String(colIndex);
    sentinelEls.set(colIndex, el);
    cardsObserver?.observe(el);
  } else {
    sentinelEls.delete(colIndex);
  }
};

onMounted(() => {
  cardsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) triggerLoadMore(Number((entry.target as HTMLElement).dataset.colIndex));
      });
    },
    { rootMargin: '400px' },
  );
  sentinelEls.forEach((el) => cardsObserver?.observe(el));
});

onBeforeUnmount(() => {
  cardsObserver?.disconnect();
  cardsObserver = null;
});

const DEADLINE_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const pluralDays = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const parseDueDate = (raw: string | Date): Date | null => {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : startOfDay(raw);

  const s = String(raw);
  const ru = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
};

const getDeadline = (card: KanbanCard): { text: string; cls: string } | null => {
  if (!card.planned_date) return null;

  const due = parseDueDate(card.planned_date as string | Date);
  if (!due) return null;

  const neutral = { text: `${due.getDate()} ${DEADLINE_MONTHS[due.getMonth()]}`, cls: 'far' };

  if (card.status === TASK_STATUSES.closed) {
    if (!card.closed_date) return neutral;
    const closed = new Date(card.closed_date);
    if (Number.isNaN(closed.getTime())) return neutral;
    return startOfDay(closed).getTime() > due.getTime() ? { text: 'Просрочено', cls: 'overdue' } : neutral;
  }

  const diffDays = Math.round((due.getTime() - startOfDay(new Date()).getTime()) / 86_400_000);

  if (diffDays < 0) return { text: 'Просрочено', cls: 'overdue' };
  if (diffDays === 0) return { text: 'Сегодня', cls: 'today' };
  if (diffDays === 1) return { text: 'Завтра', cls: 'tomorrow' };
  if (diffDays <= 6) return { text: `Через ${diffDays} ${pluralDays(diffDays)}`, cls: 'soon' };
  return neutral;
};

const draggedCard = ref<KanbanCard | null>(null);
const draggedFromColumn = ref<number | null>(null);
const draggedFromIndex = ref<number | null>(null);
const hoveredColumn = ref<number | null>(null);

const onDragStart = (columnIndex: number, cardIndex: number, card: KanbanCard, event: DragEvent) => {
  draggedCard.value = card;
  draggedFromColumn.value = columnIndex;
  draggedFromIndex.value = cardIndex;
  const el = event.target as HTMLElement;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.position = 'absolute';
  clone.style.top = '-99999px';
  clone.style.left = '-99999px';
  clone.style.width = rect.width + 'px';
  clone.style.pointerEvents = 'none';

  document.body.appendChild(clone);

  event.dataTransfer?.setDragImage(clone, offsetX, offsetY);
  requestAnimationFrame(() => clone.remove());
};

const onDragOver = (event: DragEvent) => {
  event.preventDefault();
};

const onDragOverColumn = (columnIndex: number, event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedCard.value) return;

  if (draggedFromColumn.value === columnIndex) {
    hoveredColumn.value = null;
    return;
  }

  hoveredColumn.value = columnIndex;
};

const onDragLeaveColumn = (event: DragEvent) => {
  const target = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as HTMLElement;

  if (relatedTarget && target.contains(relatedTarget)) {
    return;
  }

  hoveredColumn.value = null;
};

const onDropToColumn = (columnIndex: number, event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedCard.value) return;

  const fromCol = draggedFromColumn.value!;
  const fromIdx = draggedFromIndex.value!;

  if (fromCol === columnIndex) {
    resetDrag();
    return;
  }

  const targetColumn = columns.value[columnIndex];
  const draggedPriority = draggedCard.value.priority;
  const draggedId = draggedCard.value.id;

  columns.value[fromCol].cards.splice(fromIdx, 1);

  const insertIndex = targetColumn.cards.findIndex((card) => card.id !== draggedId && card.priority < draggedPriority);
  const finalIndex = insertIndex === -1 ? targetColumn.cards.length : insertIndex;

  columns.value[columnIndex].cards.splice(finalIndex, 0, draggedCard.value);

  draggedCard.value.status = columns.value[columnIndex].status;
  emit('update-task', draggedCard.value.id, { status: columns.value[columnIndex].status });

  resetDrag();
};

const onDropToCard = (columnIndex: number, cardIndex: number, event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedCard.value) return;
  const fromCol = draggedFromColumn.value!;
  const fromIdx = draggedFromIndex.value!;

  const targetCard = columns.value[columnIndex].cards[cardIndex];
  const targetCardId = targetCard?.id ?? null;
  const draggedCardId = draggedCard.value.id;

  if (fromCol === columnIndex) {
    const cards = columns.value[columnIndex].cards;

    const draggedCardData = { ...cards[fromIdx] };
    const targetCardData = { ...cards[cardIndex] };

    const tempPriority = draggedCardData.priority;
    draggedCardData.priority = targetCardData.priority;
    targetCardData.priority = tempPriority;

    cards.splice(fromIdx, 1, targetCardData);
    cards.splice(cardIndex, 1, draggedCardData);

    emit('swap-priority-task', [targetCardId, draggedCardId]);
  } else {
    const draggedPriority = draggedCard.value.priority;
    const draggedId = draggedCard.value.id;

    columns.value[fromCol].cards.splice(fromIdx, 1);

    const targetColumn = columns.value[columnIndex];
    const insertIndex = targetColumn.cards.findIndex((card) => card.id !== draggedId && card.priority < draggedPriority);
    const finalIndex = insertIndex === -1 ? targetColumn.cards.length : insertIndex;

    columns.value[columnIndex].cards.splice(finalIndex, 0, draggedCard.value);

    draggedCard.value.status = columns.value[columnIndex].status;
    emit('update-task', draggedCard.value.id, { status: columns.value[columnIndex].status });
  }

  resetDrag();
};

const onImgError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (!img) return;
  img.onerror = null;
  img.src = '/avatar-placeholder.svg';
};

const resetDrag = () => {
  draggedCard.value = null;
  draggedFromColumn.value = null;
  draggedFromIndex.value = null;
  hoveredColumn.value = null;
};

const dragend = () => {
  resetDrag();
};
</script>

<template>
  <div class="kanban">
    <div
      v-for="(column, colIndex) in columns"
      :key="column.id"
      class="kanban__column"
      :class="{ kanban__column_collapsed: column.collapsed }"
      @dragover="onDragOverColumn(colIndex, $event)"
      @dragleave="onDragLeaveColumn($event)"
      @drop="onDropToColumn(colIndex, $event)"
    >
      <div
        v-if="column.collapsed"
        class="kanban__collapsed"
        role="button"
        tabindex="0"
        title="Развернуть колонку"
        @click="$emit('toggle-collapse', { status: column.status, collapsed: false })"
        @keydown.enter="$emit('toggle-collapse', { status: column.status, collapsed: false })"
      >
        <span class="kanban__collapsed-expand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="kanban__collapsed-count">{{ column.total ?? column.cards.length }}</span>
        <span class="kanban__collapsed-title">
          <span class="kanban__column-header_dot" :class="'kanban__column-header_' + column.status"></span>
          {{ column.title }}
        </span>
      </div>

      <div v-if="!column.collapsed" class="kanban__column-header">
        <span class="kanban__column-header_dot" :class="'kanban__column-header_' + column.status"></span>
        <span>{{ column.title }}</span>
        <span>{{ column.total ?? column.cards.length }}</span>
        <span v-if="column.cards.some((c) => c.story_points != null)" class="kanban__column-header_sp">
          {{ column.cards.reduce((sum, c) => sum + (Number(c.story_points) || 0), 0) }} SP
        </span>
        <button
          class="kanban__collapse-btn"
          type="button"
          title="Свернуть колонку"
          @click="$emit('toggle-collapse', { status: column.status, collapsed: true })"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <div v-if="!column.collapsed && hoveredColumn === colIndex" class="kanban__column-placeholder">
        <div class="kanban__column-placeholder-text">
          Задача встанет в соответствии со своим приоритетом {{ draggedCard?.priority }}
        </div>
      </div>

      <div
        v-if="!column.collapsed"
        class="kanban__cards"
        :class="{ 'kanban__cards_with-placeholder': hoveredColumn === colIndex }"
      >
        <template v-for="(card, cardIndex) in column.cards" :key="card.id">
          <div
            draggable="true"
            class="kanban__card"
            :class="{
              kanban__card_hidden: draggedCard?.id === card.id,
              kanban__card_closed: card.status === TASK_STATUSES.closed,
            }"
            @click="$emit('click-to-card', card.id)"
            @dragstart="onDragStart(colIndex, cardIndex, card, $event)"
            @dragover="onDragOver"
            @drop="onDropToCard(colIndex, cardIndex, $event)"
            @dragend="dragend()"
          >
            <div v-if="card.taskType === TaskType.USER_STORY && card.coverImage" class="kanban_cover">
              <img :src="resolveAwsUrl(card.coverImage)" alt="" draggable="false" />
            </div>

            <div class="kanban__card-header">
              <div class="kanban__project-name">{{ card.projectName }}</div>
              <div v-if="card.users?.length" class="kanban__card_users">
                <img v-for="(user, idx) in card.users" :key="idx" :src="user" class="kanban__card_user" @error="onImgError" />
              </div>
              <svg v-if="false" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12.5 15.8333C12.5 13.9924 10.2614 12.5 7.5 12.5C4.73858 12.5 2.5 13.9924 2.5 15.8333M15.8333 13.3333V10.8333M15.8333 10.8333V8.33334M15.8333 10.8333H13.3333M15.8333 10.8333H18.3333M7.5 10C5.65905 10 4.16667 8.50763 4.16667 6.66668C4.16667 4.82573 5.65905 3.33334 7.5 3.33334C9.34095 3.33334 10.8333 4.82573 10.8333 6.66668C10.8333 8.50763 9.34095 10 7.5 10Z"
                  stroke="#FEFEFE"
                  stroke-opacity="0.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>

            <div class="kanban__card_title">
              <span v-if="card.taskType === TaskType.TASK" class="kanban__card-status kanban__card-status_task">
                <IconsIconTypeTask />
              </span>
              <span v-if="card.taskType === TaskType.USER_STORY" class="kanban__card-status kanban__card-status_story">
                <IconsIconTypeUserStory />
              </span>
              {{ card.title }}
            </div>
            <div v-if="card.description" class="kanban__card_desc">
              {{ card.description }}
            </div>
            <div v-if="card.planned_date || card.story_points != null" class="kanban__card_footer">
              <span
                v-if="card.planned_date"
                class="kanban__card_deadline"
                :class="`kanban__card_deadline_${getDeadline(card)?.cls}`"
              >
                {{ getDeadline(card)?.text }}
              </span>
              <div v-if="card.story_points != null" class="kanban__card_sp">{{ card.story_points }} SP</div>
            </div>
          </div>
        </template>
        <div
          v-if="column.cards.length < (column.total ?? column.cards.length)"
          :ref="(el) => setSentinel(el, colIndex)"
          class="kanban__cards-loader"
        >
          {{ loadingColumns.has(column.status) ? 'Загрузка…' : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.kanban {
  @include flex(rn, stretch);
  width: 100%;
  overflow-x: auto;
  border-radius: 8px;
  box-sizing: border-box;
  height: 100%;

  &__card-header {
    @include flex(rn, between);
    width: 100%;
    color: var(--light-text-backgroung-primary-50);

    @extend %text-xs-regular;
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

    &:first-child {
      padding-left: 0;
    }

    &:last-child {
      padding-right: 0;
      border-right: none;
    }

    &_collapsed {
      flex: 0 0 auto;
      min-width: 0;
      width: 44px;
      padding: 0;
      gap: 0;
    }
  }

  &__collapsed {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 100%;
    padding: 12px 0;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &-expand {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--light-text-backgroung-primary-50);
    }

    &-count {
      @extend %text-s-medium;
      min-width: 20px;
      padding: 1px 6px;
      border-radius: 8px;
      text-align: center;
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      writing-mode: vertical-rl;
      white-space: nowrap;
      @extend %text-l-regular;
      color: var(--light-text-backgroung-primary);
    }
  }

  &__collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 2px;
    border: none;
    background: transparent;
    border-radius: 6px;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__column-header {
    @include flex(a-center);
    gap: 8px;
    border-radius: 12px;

    @extend %text-l-regular;
    color: var(--light-text-backgroung-primary);

    &_dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    &_open,
    &_backlog {
      background: var(--light-text-backgroung-primary);
    }

    &_to_do {
      background: var(--status-blue);
    }

    &_in_progress {
      background: var(--status-in-progress);
    }

    &_in_review {
      background: var(--status-violet);
    }

    &_testing {
      background: var(--status-rose);
    }

    &_ready_for_release {
      background: var(--status-emerald);
    }

    &_prod_check {
      background: var(--status-cyan);
    }

    &_control {
      background: var(--status-indigo);
    }

    &_ready_for_release {
      background: var(--status-emerald);
    }

    &_prod_check {
      background: var(--status-cyan);
    }

    &_control {
      background: var(--status-indigo);
    }

    &_closed {
      background: var(--green);
    }

    span {
      &:nth-child(2) {
        @extend %text-l-regular;
      }
    }

    span {
      &:nth-child(3) {
        @extend %text-xs-light;
        color: var(--light-text-backgroung-primary-50);
      }
    }

    &_sp {
      @extend %text-xs-medium;
      margin-left: auto;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--primary-15);
      color: var(--primary);
    }
  }

  &__column-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border: 2px dashed var(--primary-50);
    border-radius: 8px;
    background: var(--primary-5);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;

    animation: pulse 1.5s ease-in-out infinite;
  }

  &__column-placeholder-text {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    text-align: center;
    padding: 16px 24px;
    background: var(--primary);
    border-radius: 8px;
    box-shadow: 0 4px 12px var(--black-40);
    border: 2px solid var(--light-text-backgroung-primary-25);
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 290px;
    flex: 1;

    &_with-placeholder {
      opacity: 0.3;
    }
  }

  &__cards-loader {
    padding: 12px;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
    flex-shrink: 0;
  }

  &__card {
    position: relative;
    cursor: pointer;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 8px;
    gap: 4px;
    min-width: 290px;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    box-shadow: 0 2px 4px 0 var(--black-10);
    backdrop-filter: blur(12px);
    &:hover {
      background: var(--light-text-backgroung-primary-10);
      backdrop-filter: blur(12px);
    }

    &_closed {
      text-decoration: line-through;
      opacity: 0.6;
    }

    &_project {
      @extend %p12-medium;
      color: var(--light-text-backgroung-primary-50);
    }

    &_users {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    &_user {
      bottom: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
    }

    &_title {
      @extend %text-s-medium;
      color: var(--light-text-backgroung-primary);
      width: 100%;
      display: block;
      overflow: hidden;
    }

    &-status {
      float: left;
      margin-right: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    &_desc {
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
      width: 100%;
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }

    &_hidden {
      opacity: 0;
    }

    &_sp {
      @extend %text-xs-medium;
      color: var(--primary);
      background: var(--primary-10);
      border-radius: 4px;
      padding: 1px 6px;
      align-self: flex-start;
    }

    &_footer {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
    }

    &_deadline {
      @extend %text-xs-medium;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 4px;
      white-space: nowrap;

      &_overdue,
      &_today {
        color: var(--secondary);
        background: var(--secondary-15);
      }

      &_tomorrow {
        color: var(--accent);
        background: var(--accent-15);
      }

      &_soon {
        color: var(--status-yellow);
        background: var(--status-yellow-15);
      }

      &_far {
        color: var(--light-text-backgroung-primary-50);
        background: var(--light-text-backgroung-primary-10);
      }
    }
  }

  &__project-name {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__card-status {
    @include flex(center);
    width: 18px;
    height: 18px;
    border-radius: 4px;
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

  &_cover {
    width: 100%;
    height: 180px;
    border-radius: 4px;
    overflow: hidden;
    user-select: none;
    pointer-events: none;
    margin-bottom: 4px;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      user-select: none;
      pointer-events: none;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }
}
</style>
