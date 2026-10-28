<script setup lang="ts">
import type { TaskStatus, TaskStage } from '@tracker/contracts';

import TaskCode from '~/components/TaskCode.vue';
import {
  GripVertical,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Lock,
  Ellipsis,
  Plus,
  Flag,
  FlagOff,
  CalendarDays,
  X,
} from '@lucide/vue';
import type { PropType } from 'vue';
import { TASK_STATUSES, TASK_STATUS_DESCRIPTIONS } from '~/constants/task.constants';
import { TaskType } from '~/enums/task.enums';
import { getErrorMessage } from '~/utils/error';

const TASK_STATUS_DESCRIPTION_PARTS = Object.fromEntries(
  Object.entries(TASK_STATUS_DESCRIPTIONS).map(([status, description]) => {
    const [entry = '', exit = ''] = description.split(' Выход: ');

    return [
      status,
      {
        entry: entry.replace(/^Вход:\s*/, ''),
        exit,
      },
    ];
  }),
) as Record<TaskStatus, { entry: string; exit: string }>;

const { resolveAwsUrl } = useResolveUrl();
const { isDragging: isBoardDragging, onPointerDown, onPointerMove, onPointerEnd } = useHorizontalDragScroll();

const props = defineProps({
  editingStages: { type: Boolean, default: false },
  stageDraft: { type: Array as PropType<TaskStage[]>, default: () => [] },
  stagesBusy: { type: Boolean, default: false },
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
  quickCreateEnabled: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits([
  'click-to-card',
  'swap-priority-task',
  'update-task',
  'toggle-collapse',
  'load-more',
  'task-created',
  'add-stage',
  'rename-stage',
  'delete-stage',
  'reorder-stages',
]);

const taskStore = useTaskStore();
const { $toast } = useNuxtApp();
const contextMenu = ref<{ card: KanbanCard; x: number; y: number } | null>(null);
const contextMenuElement = ref<HTMLElement | null>(null);
const contextMenuTrigger = ref<HTMLElement | null>(null);
const deadlinePicker = ref<{ card: KanbanCard; x: number; y: number } | null>(null);
const deadlinePickerElement = ref<HTMLElement | null>(null);
const deadlineDate = ref<Date | null>(null);
const deadlinePending = ref(false);
const selectedCard = ref<KanbanCard | null>(null);
const flagComment = ref('');
const flagCommentInput = ref<HTMLTextAreaElement | null>(null);
const deleteCancelButton = ref<HTMLButtonElement | null>(null);
const flagModalOpen = ref(false);
const deleteModalOpen = ref(false);
const actionPending = ref(false);

const closeContextMenu = (restoreFocus = false) => {
  const trigger = contextMenuTrigger.value;
  contextMenu.value = null;
  if (restoreFocus) nextTick(() => trigger?.focus());
};

const closeDeadlinePicker = (restoreFocus = false) => {
  const trigger = contextMenuTrigger.value;
  deadlinePicker.value = null;
  deadlineDate.value = null;
  if (restoreFocus) nextTick(() => trigger?.focus());
};

const openContextMenu = async (card: KanbanCard, event: MouseEvent | KeyboardEvent) => {
  if (props.editingStages) return;
  event.preventDefault();
  event.stopPropagation();
  closeDeadlinePicker();
  const cardElement = event.currentTarget as HTMLElement;
  const rect = cardElement.getBoundingClientRect();
  const x = ('clientX' in event && event.clientX) || rect.left + 16;
  const y = ('clientY' in event && event.clientY) || rect.top + 16;
  contextMenuTrigger.value = cardElement;
  contextMenu.value = { card, x, y };
  await nextTick();
  const menu = contextMenuElement.value;
  if (!menu || !contextMenu.value) return;
  const menuRect = menu.getBoundingClientRect();
  contextMenu.value = {
    card,
    x: Math.max(8, Math.min(x, window.innerWidth - menuRect.width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuRect.height - 8)),
  };
  await nextTick();
  contextMenuElement.value?.querySelector<HTMLButtonElement>('button')?.focus();
};

const onCardKeydown = (card: KanbanCard, event: KeyboardEvent) => {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  openContextMenu(card, event);
};

const moveContextMenuFocus = (direction: number) => {
  const items = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  if (!items.length) return;
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(currentIndex + direction + items.length) % items.length]?.focus();
};

const toDeadlineDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = parseDueDate(value);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day);
};

const toDeadlinePayload = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const openDeadlinePicker = async (card: KanbanCard) => {
  if (!contextMenu.value) return;
  const { x, y } = contextMenu.value;
  deadlineDate.value = toDeadlineDate(card.planned_date);
  deadlinePicker.value = { card, x, y };
  closeContextMenu();
  await nextTick();

  const picker = deadlinePickerElement.value;
  if (!picker || !deadlinePicker.value) return;
  const pickerRect = picker.getBoundingClientRect();
  deadlinePicker.value = {
    card,
    x: Math.max(8, Math.min(x, window.innerWidth - pickerRect.width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - pickerRect.height - 8)),
  };
  await nextTick();
  deadlinePickerElement.value?.focus();
};

const saveDeadline = async (value: Date | null) => {
  if (!value || !deadlinePicker.value || deadlinePending.value) return;
  const card = deadlinePicker.value.card;
  const hadDeadline = Boolean(card.planned_date);
  deadlinePending.value = true;
  try {
    await taskStore.updateTask(Number(card.id), { planned_date: toDeadlinePayload(value) });
    $toast.success(hadDeadline ? 'Дедлайн изменён' : 'Дедлайн установлен');
    closeDeadlinePicker(true);
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    deadlinePending.value = false;
  }
};

const removeDeadline = async () => {
  if (!deadlinePicker.value || deadlinePending.value) return;
  const card = deadlinePicker.value.card;
  deadlinePending.value = true;
  try {
    await taskStore.updateTask(Number(card.id), { planned_date: null });
    $toast.success('Дедлайн удалён');
    closeDeadlinePicker(true);
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    deadlinePending.value = false;
  }
};

const openFlagModal = (card: KanbanCard) => {
  selectedCard.value = card;
  flagComment.value = '';
  flagModalOpen.value = true;
  closeContextMenu();
  nextTick(() => flagCommentInput.value?.focus());
};

const openDeleteModal = (card: KanbanCard) => {
  selectedCard.value = card;
  deleteModalOpen.value = true;
  closeContextMenu();
  nextTick(() => deleteCancelButton.value?.focus());
};

const saveFlag = async () => {
  if (!selectedCard.value || actionPending.value) return;
  actionPending.value = true;
  try {
    await taskStore.updateTask(Number(selectedCard.value.id), {
      is_flagged: true,
      flag_comment: flagComment.value.trim() || null,
    });
    flagModalOpen.value = false;
    $toast.success('Метка добавлена');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    actionPending.value = false;
  }
};

const removeFlag = async (card: KanbanCard) => {
  closeContextMenu();
  try {
    await taskStore.updateTask(Number(card.id), { is_flagged: false, flag_comment: null });
    $toast.success('Метка снята');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
};

const deleteSelectedTask = async () => {
  if (!selectedCard.value || actionPending.value) return;
  const taskId = Number(selectedCard.value.id);
  const taskStatus = selectedCard.value.status;
  actionPending.value = true;
  try {
    await taskStore.deleteTask(taskId);
    taskStore.tasks = taskStore.tasks.filter((task) => task.id !== taskId);
    taskStore.tasksWithTimelogs = taskStore.tasksWithTimelogs.filter((task) => task.id !== taskId);
    for (const column of taskStore.kanban) {
      column.cards = column.cards.filter((card) => Number(card.id) !== taskId);
      if (column.status === taskStatus && column.total !== undefined) column.total = Math.max(0, column.total - 1);
    }
    deleteModalOpen.value = false;
    $toast.trash('Задача успешно удалена');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    actionPending.value = false;
  }
};

const handleDocumentPointer = (event: PointerEvent) => {
  if (contextMenuElement.value?.contains(event.target as Node)) return;
  if (deadlinePickerElement.value?.contains(event.target as Node)) return;
  closeContextMenu();
  closeDeadlinePicker();
};
const handleViewportChange = () => {
  closeContextMenu();
  closeDeadlinePicker();
};

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});

const quickCreatePending = ref(false);
const quickCreateStatus = ref<string | null>(null);
const createTrigger = ref<HTMLButtonElement | null>(null);
const openQuickCreate = (status: string, event: MouseEvent) => {
  createTrigger.value = event.currentTarget as HTMLButtonElement;
  quickCreateStatus.value = status;
};
const closeQuickCreate = async () => {
  quickCreateStatus.value = null;
  await nextTick();
  createTrigger.value?.focus();
};
const onTaskCreated = () => {
  closeQuickCreate();
  emit('task-created');
};

watch(
  () => props.quickCreateEnabled,
  (enabled) => {
    if (!enabled) quickCreateStatus.value = null;
  },
);

const { stages } = useTaskStages();
const stageDefinitions = computed(() => (props.editingStages ? props.stageDraft : stages.value));
const columns = computed<KanbanColumn[]>(() => {
  if (!props.editingStages) return props.columns;
  return props.stageDraft.map((stage) => ({
    ...(props.columns.find((column) => column.status === stage.id) ?? { cards: [], total: 0 }),
    id: stage.id,
    status: stage.id,
    title: stage.title,
    collapsed: false,
  }));
});
const configuredStage = (id: string) => stageDefinitions.value.some((stage) => stage.id === id);
const protectedStage = (id: string) => stageDefinitions.value.find((stage) => stage.id === id)?.protected ?? true;
const draggedStage = ref<string | null>(null);
const stageInsertIndex = ref<number | null>(null);
const stageMenu = ref<string | null>(null);
const boardElement = ref<HTMLElement | null>(null);
const draggedStageTitle = computed(() => columns.value.find((column) => column.status === draggedStage.value)?.title);
let scrollFrame: number | null = null;
let scrollSpeed = 0;
const stopStageScroll = () => {
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  scrollFrame = null;
  scrollSpeed = 0;
};
const resetStageDrag = () => {
  draggedStage.value = null;
  stageInsertIndex.value = null;
  stopStageScroll();
};
const scrollStageBoard = () => {
  if (!boardElement.value || !draggedStage.value || !scrollSpeed) {
    stopStageScroll();
    return;
  }
  boardElement.value.scrollLeft += scrollSpeed;
  scrollFrame = requestAnimationFrame(scrollStageBoard);
};
const trackStagePointer = (event: DragEvent) => {
  if (!draggedStage.value || !boardElement.value) return;
  event.preventDefault();
  const rect = boardElement.value.getBoundingClientRect();
  const edge = 64;
  scrollSpeed = event.clientX < rect.left + edge ? -10 : event.clientX > rect.right - edge ? 10 : 0;
  if (scrollSpeed && scrollFrame === null) scrollFrame = requestAnimationFrame(scrollStageBoard);
  if (!scrollSpeed) stopStageScroll();
};
const leaveStageBoard = (event: DragEvent) => {
  if (event.relatedTarget instanceof Node && boardElement.value?.contains(event.relatedTarget)) return;
  const rect = boardElement.value?.getBoundingClientRect();
  if (
    rect &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
    return;
  stageInsertIndex.value = null;
  stopStageScroll();
};
const reorderStage = (source: string, destination: string) => {
  if (props.stagesBusy || source === destination || !configuredStage(source) || !configuredStage(destination)) return;
  const ids = columns.value.map((column) => column.status).filter(configuredStage);
  const from = ids.indexOf(source);
  const to = ids.indexOf(destination);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, source);
  stageMenu.value = null;
  emit('reorder-stages', ids);
};
const moveStage = (id: string, direction: number) => {
  const ids = columns.value.map((column) => column.status).filter(configuredStage);
  const destination = ids[ids.indexOf(id) + direction];
  if (destination) reorderStage(id, destination);
};
const canMoveStage = (id: string, direction: number) => {
  const ids = columns.value.map((column) => column.status).filter(configuredStage);
  return configuredStage(id) && !!ids[ids.indexOf(id) + direction];
};
const startStageDrag = (id: string, event: DragEvent) => {
  if (props.stagesBusy || !configuredStage(id)) {
    event.preventDefault();
    return;
  }
  stageMenu.value = null;
  draggedStage.value = id;
  stageInsertIndex.value = null;
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    const header = (event.currentTarget as HTMLElement).closest('.kanban__stage-header');
    if (header) event.dataTransfer.setDragImage(header, 24, 20);
  }
};
const setStageInsertion = (columnIndex: number, event: DragEvent) => {
  const column = columns.value[columnIndex];
  if (!column || !configuredStage(column.status)) return;
  const element = (event.target as HTMLElement).closest('.kanban__column');
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const index = columnIndex + (event.clientX >= rect.left + rect.width / 2 ? 1 : 0);
  const sourceIndex = columns.value.findIndex((item) => item.status === draggedStage.value);
  stageInsertIndex.value = index === sourceIndex || index === sourceIndex + 1 ? null : index;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
};
const dropStage = () => {
  const source = draggedStage.value;
  const insertion = stageInsertIndex.value;
  if (!source || insertion === null || props.stagesBusy) {
    resetStageDrag();
    return;
  }
  const original = columns.value.map((column) => column.status).filter(configuredStage);
  const before = columns.value
    .slice(0, insertion)
    .filter((column) => configuredStage(column.status) && column.status !== source).length;
  const ids = original.filter((id) => id !== source);
  ids.splice(before, 0, source);
  resetStageDrag();
  if (ids.some((id, index) => id !== original[index])) emit('reorder-stages', ids);
};
onBeforeUnmount(stopStageScroll);

watch(
  () => props.editingStages,
  () => {
    quickCreateStatus.value = null;
    stageMenu.value = null;
    closeContextMenu();
    resetStageDrag();
  },
);

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
  // Function refs run on every render, including loading-state changes.
  // Re-observing the same node delivers another initial intersection event.
  if (prev === el) return;
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
const TASKS_TIME_ZONE = 'Europe/Moscow';
const DAY_MS = 86_400_000;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
  dayNumber: number;
}

const calendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TASKS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const createCalendarDate = (year: number, month: number, day: number): CalendarDate | null => {
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day) return null;

  return {
    year,
    month,
    day,
    dayNumber: Math.floor(utcDate.getTime() / DAY_MS),
  };
};

const getCalendarDate = (date: Date): CalendarDate | null => {
  if (Number.isNaN(date.getTime())) return null;

  const parts = calendarDateFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return createCalendarDate(year, month, day);
};

const currentDayNumber = getCalendarDate(new Date())?.dayNumber;

const pluralDays = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
};

const parseDueDate = (raw: string | Date): CalendarDate | null => {
  if (raw instanceof Date) return getCalendarDate(raw);

  const s = String(raw);
  const ru = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return createCalendarDate(Number(ru[3]), Number(ru[2]), Number(ru[1]));

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return createCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return getCalendarDate(new Date(s));
};

const getDeadline = (card: KanbanCard): { text: string; cls: string } | null => {
  if (!card.planned_date) return null;

  const due = parseDueDate(card.planned_date as string | Date);
  if (!due) return null;

  const neutral = { text: `${due.day} ${DEADLINE_MONTHS[due.month - 1]}`, cls: 'far' };

  if (card.closed_date) {
    const closed = getCalendarDate(new Date(card.closed_date));
    if (!closed) return neutral;
    return closed.dayNumber > due.dayNumber ? { text: 'Просрочено', cls: 'overdue' } : neutral;
  }

  if (card.status === TASK_STATUSES.closed) return neutral;
  if (currentDayNumber == null) return neutral;

  const diffDays = due.dayNumber - currentDayNumber;

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
  closeContextMenu();
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
  if (props.editingStages && draggedStage.value) {
    setStageInsertion(columnIndex, event);
    return;
  }
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
  if (props.editingStages && draggedStage.value) {
    setStageInsertion(columnIndex, event);
    dropStage();
    return;
  }
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
  if (props.editingStages && draggedStage.value) {
    onDropToColumn(columnIndex, event);
    return;
  }
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
  <div
    ref="boardElement"
    class="kanban"
    :class="{ kanban_dragging: isBoardDragging, kanban_editing: editingStages }"
    @dragover.capture="trackStagePointer"
    @dragleave="leaveStageBoard"
    @drop.prevent="draggedStage && dropStage()"
    @keydown.esc="resetStageDrag"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
  >
    <template v-for="(column, colIndex) in columns" :key="column.id">
      <div
        v-if="draggedStage && stageInsertIndex === colIndex"
        class="kanban__stage-placeholder"
        @dragover.prevent.stop
        @drop.prevent.stop="dropStage"
      >
        <GripVertical :size="20" :stroke-width="1.75" aria-hidden="true" />
        <strong>{{ draggedStageTitle }}</strong
        ><span>Переместить сюда</span>
      </div>
      <div
        class="kanban__column"
        :class="{ kanban__column_collapsed: column.collapsed, 'kanban__column_stage-dragging': draggedStage === column.status }"
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

        <div v-if="editingStages" class="kanban__stage-header">
          <button
            type="button"
            class="kanban__stage-icon kanban__stage-grip"
            :draggable="!stagesBusy && configuredStage(column.status)"
            :disabled="stagesBusy || !configuredStage(column.status)"
            :aria-label="`Переместить этап ${column.title}`"
            title="Перетащите колонку. С клавиатуры: влево или вправо"
            @dragstart.stop="startStageDrag(column.status, $event)"
            @dragend="resetStageDrag"
            @keydown.left.prevent="moveStage(column.status, -1)"
            @keydown.right.prevent="moveStage(column.status, 1)"
          >
            <GripVertical :size="18" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <span v-if="protectedStage(column.status)" class="kanban__stage-name">{{ column.title }}</span>
          <button
            v-else
            type="button"
            class="kanban__stage-name kanban__stage-name_editable"
            :disabled="stagesBusy"
            :title="`Переименовать этап ${column.title}`"
            @click="emit('rename-stage', column.status)"
          >
            <span>{{ column.title }}</span
            ><Pencil :size="14" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <Lock
            v-if="protectedStage(column.status)"
            class="kanban__stage-lock"
            :size="14"
            :stroke-width="1.75"
            role="img"
            aria-label="Нельзя переименовать или удалить"
          />
          <div
            v-click-outside="
              () => {
                if (stageMenu === column.status) stageMenu = null;
              }
            "
            class="kanban__stage-actions"
            @keydown.esc.stop="stageMenu = null"
          >
            <button
              type="button"
              class="kanban__stage-icon"
              :disabled="stagesBusy"
              :aria-expanded="stageMenu === column.status"
              :aria-label="`Действия с этапом ${column.title}`"
              @click="stageMenu = stageMenu === column.status ? null : column.status"
            >
              <Ellipsis :size="18" :stroke-width="1.75" aria-hidden="true" />
            </button>
            <div v-if="stageMenu === column.status" class="kanban__stage-menu">
              <button
                v-if="configuredStage(column.status)"
                type="button"
                @click="
                  emit('add-stage', column.status);
                  stageMenu = null;
                "
              >
                <Plus :size="16" :stroke-width="1.75" /> Добавить этап после
              </button>
              <button
                v-if="!protectedStage(column.status)"
                type="button"
                @click="
                  emit('rename-stage', column.status);
                  stageMenu = null;
                "
              >
                <Pencil :size="16" :stroke-width="1.75" /> Переименовать
              </button>
              <button type="button" :disabled="!canMoveStage(column.status, -1)" @click="moveStage(column.status, -1)">
                <ChevronLeft :size="16" :stroke-width="1.75" /> Переместить влево
              </button>
              <button type="button" :disabled="!canMoveStage(column.status, 1)" @click="moveStage(column.status, 1)">
                <ChevronRight :size="16" :stroke-width="1.75" /> Переместить вправо
              </button>
              <button
                v-if="!protectedStage(column.status)"
                type="button"
                class="kanban__stage-delete"
                @click="
                  emit('delete-stage', column.status);
                  stageMenu = null;
                "
              >
                <Trash2 :size="16" :stroke-width="1.75" /> Удалить этап
              </button>
            </div>
          </div>
        </div>
        <div v-if="!column.collapsed && !editingStages" class="kanban__column-header">
          <span
            class="kanban__column-status"
            tabindex="0"
            :aria-describedby="TASK_STATUS_DESCRIPTION_PARTS[column.status] ? `kanban-status-tooltip-${column.id}` : undefined"
          >
            <span class="kanban__column-header_dot" :class="'kanban__column-header_' + column.status"></span>
            <span class="kanban__column-header_title">{{ column.title }}</span>
            <span
              v-if="TASK_STATUS_DESCRIPTION_PARTS[column.status]"
              :id="`kanban-status-tooltip-${column.id}`"
              class="kanban__status-tooltip"
              role="tooltip"
            >
              <span class="kanban__status-tooltip-section">
                <strong>Вход:</strong> {{ TASK_STATUS_DESCRIPTION_PARTS[column.status].entry }}
              </span>
              <span class="kanban__status-tooltip-section">
                <strong>Выход:</strong> {{ TASK_STATUS_DESCRIPTION_PARTS[column.status].exit }}
              </span>
            </span>
          </span>
          <span class="kanban__column-header_count">{{ column.total ?? column.cards.length }}</span>
          <span v-if="column.cards.some((c) => c.story_points != null)" class="kanban__column-header_sp">
            {{ column.cards.reduce((sum, c) => sum + (Number(c.story_points) || 0), 0) }} SP
          </span>
          <button
            v-if="quickCreateEnabled && configuredStage(column.status)"
            class="kanban__create-btn"
            :class="{ 'kanban__create-btn_active': quickCreateStatus === column.status }"
            :disabled="quickCreatePending"
            type="button"
            :title="`Создать задачу в колонке «${column.title}»`"
            :aria-label="`Создать задачу в колонке «${column.title}»`"
            :aria-expanded="quickCreateStatus === column.status"
            @click="openQuickCreate(column.status, $event)"
          >
            <IconsIconPlus />
          </button>
          <button
            v-if="!editingStages"
            class="kanban__collapse-btn"
            :disabled="quickCreatePending"
            type="button"
            title="Свернуть колонку"
            @click="$emit('toggle-collapse', { status: column.status, collapsed: true })"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        <KanbanQuickCreate
          v-if="quickCreateEnabled && !column.collapsed && quickCreateStatus === column.status"
          class="kanban__quick-create"
          :status="column.status"
          @close="closeQuickCreate"
          @created="onTaskCreated"
          @pending="quickCreatePending = $event"
        />

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
            <BaseKanbanCard
              as="div"
              :draggable="!editingStages"
              role="button"
              tabindex="0"
              :class="{
                kanban__card_hidden: draggedCard?.id === card.id,
              }"
              :muted="card.status === TASK_STATUSES.closed"
              @click="$emit('click-to-card', card.id)"
              @keydown.enter.prevent="$emit('click-to-card', card.id)"
              @keydown.space.prevent="$emit('click-to-card', card.id)"
              @keydown="onCardKeydown(card, $event)"
              @contextmenu="openContextMenu(card, $event)"
              @dragstart="onDragStart(colIndex, cardIndex, card, $event)"
              @dragover="onDragOver"
              @drop="onDropToCard(colIndex, cardIndex, $event)"
              @dragend="dragend()"
            >
              <template v-if="card.taskType === TaskType.USER_STORY && card.coverImage" #media>
                <div class="kanban_cover">
                  <img :src="resolveAwsUrl(card.coverImage)" alt="" draggable="false" />
                </div>
              </template>
              <template #header>
                <div class="kanban__project-name" :title="card.projectName">{{ card.projectName }}</div>
                <TaskCode :id="card.id" />
              </template>
              <template #title>
                {{ card.title }}
              </template>
              <template v-if="card.description" #description>{{ card.description }}</template>
              <template v-if="card.taskType || card.is_flagged || card.planned_date || card.story_points != null || card.users?.length" #footer>
                <TaskTypeBadge v-if="card.taskType" :task-type="card.taskType" />
                <Flag
                  v-if="card.is_flagged"
                  class="kanban__card-flag"
                  :size="16"
                  :stroke-width="2"
                  fill="currentColor"
                  role="img"
                  aria-label="Задача отмечена"
                  :title="card.flag_comment || 'Задача отмечена'"
                />
                <span
                  v-if="card.planned_date"
                  class="kanban__card_deadline"
                  :class="`kanban__card_deadline_${getDeadline(card)?.cls}`"
                >
                  {{ getDeadline(card)?.text }}
                </span>
                <div v-if="card.story_points != null" class="kanban__card_sp">{{ card.story_points }} SP</div>
                <div v-if="card.users?.length" class="kanban__card_users">
                  <img v-for="(user, idx) in card.users" :key="idx" :src="user" class="kanban__card_user" @error="onImgError" />
                </div>
              </template>
            </BaseKanbanCard>
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
    </template>
    <div
      v-if="draggedStage && stageInsertIndex === columns.length"
      class="kanban__stage-placeholder"
      @dragover.prevent.stop
      @drop.prevent.stop="dropStage"
    >
      <GripVertical :size="20" :stroke-width="1.75" aria-hidden="true" />
      <strong>{{ draggedStageTitle }}</strong
      ><span>Переместить сюда</span>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="contextMenu"
      ref="contextMenuElement"
      class="kanban-context-menu"
      role="menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @keydown.esc.stop="closeContextMenu(true)"
      @keydown.down.prevent="moveContextMenuFocus(1)"
      @keydown.up.prevent="moveContextMenuFocus(-1)"
    >
      <button type="button" role="menuitem" @click="openDeadlinePicker(contextMenu.card)">
        <CalendarDays :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span>{{ contextMenu.card.planned_date ? 'Изменить дедлайн' : 'Установить дедлайн' }}</span>
      </button>
      <button
        v-if="!contextMenu.card.is_flagged"
        type="button"
        role="menuitem"
        @click="openFlagModal(contextMenu.card)"
      >
        <Flag :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span>Добавить флажок</span>
      </button>
      <button v-else type="button" role="menuitem" @click="removeFlag(contextMenu.card)">
        <FlagOff :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span>Удалить флажок</span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="kanban-context-menu__delete"
        @click="openDeleteModal(contextMenu.card)"
      >
        <Trash2 :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span>Удалить задачу</span>
      </button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="deadlinePicker"
      ref="deadlinePickerElement"
      class="kanban-deadline-picker"
      role="dialog"
      aria-label="Выбор дедлайна"
      tabindex="-1"
      :style="{ left: `${deadlinePicker.x}px`, top: `${deadlinePicker.y}px` }"
      @keydown.esc.stop="closeDeadlinePicker(true)"
    >
      <div class="kanban-deadline-picker__header">
        <div>
          <strong>{{ deadlinePicker.card.planned_date ? 'Изменить дедлайн' : 'Установить дедлайн' }}</strong>
          <span>Выберите дату</span>
        </div>
        <button type="button" aria-label="Закрыть календарь" @click="closeDeadlinePicker(true)">
          <X :size="18" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </div>
      <BaseDatePicker
        v-model="deadlineDate"
        inline
        :disabled="deadlinePending"
        @update:model-value="saveDeadline"
      />
      <button
        v-if="deadlinePicker.card.planned_date"
        type="button"
        class="kanban-deadline-picker__remove"
        :disabled="deadlinePending"
        @click="removeDeadline"
      >
        Удалить дедлайн
      </button>
    </div>
  </Teleport>

  <BaseModal v-model="flagModalOpen" padded>
    <form class="kanban-action-modal" @submit.prevent="saveFlag">
      <div class="kanban-action-modal__header">
        <h2>Добавить метку</h2>
        <p>Флажок появится рядом с типом задачи.</p>
      </div>
      <label class="kanban-action-modal__field">
        <span>Комментарий <small>необязательно</small></span>
        <textarea
          ref="flagCommentInput"
          v-model="flagComment"
          name="flag-comment"
          maxlength="500"
          rows="4"
          placeholder="Например, обратить внимание на сроки"
        ></textarea>
      </label>
      <div class="kanban-action-modal__buttons">
        <button
          type="button"
          class="kanban-action-modal__secondary"
          :disabled="actionPending"
          @click="flagModalOpen = false"
        >
          Отменить
        </button>
        <button type="submit" :disabled="actionPending">{{ actionPending ? 'Добавление...' : 'Добавить' }}</button>
      </div>
    </form>
  </BaseModal>

  <BaseModal v-model="deleteModalOpen" padded>
    <div class="kanban-action-modal">
      <div class="kanban-action-modal__header">
        <h2>Удалить задачу?</h2>
        <p>
          Задача "{{ selectedCard?.title }}" и все прикреплённые к ней файлы будут удалены без возможности восстановления.
        </p>
      </div>
      <div class="kanban-action-modal__buttons">
        <button
          ref="deleteCancelButton"
          type="button"
          class="kanban-action-modal__secondary"
          :disabled="actionPending"
          @click="deleteModalOpen = false"
        >
          Отменить
        </button>
        <button type="button" class="kanban-action-modal__danger" :disabled="actionPending" @click="deleteSelectedTask">
          {{ actionPending ? 'Удаление...' : 'Удалить' }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.kanban {
  @include flex(rn, stretch);
  width: 100%;
  overflow-x: auto;
  cursor: grab;
  border-radius: 8px;
  box-sizing: border-box;
  height: 100%;

  &__stage-header {
    @include flex(rn, a-center);
    gap: 4px;
    width: 100%;
    min-height: 40px;
    padding: 4px 0;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    flex-shrink: 0;
  }
  &__stage-icon {
    @include flex(center);
    flex: 0 0 28px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    &:hover:not(:disabled) {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  &__stage-grip {
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
  }
  &__stage-name {
    @include flex(rn, a-center, j-start);
    min-height: 32px;
    padding: 6px 4px;
    @extend %text-s-medium;
    min-width: 0;
    flex: 1;
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;
    text-align: left;
    &_editable {
      @include flex(rn, a-center);
      gap: 8px;
      padding: 6px 4px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      span {
        min-width: 0;
      }
      svg {
        flex-shrink: 0;
        color: var(--light-text-backgroung-primary-50);
        opacity: 0;
      }
      &:hover,
      &:focus-visible {
        background: var(--light-text-backgroung-primary-5);
        svg {
          opacity: 1;
        }
      }
    }
  }
  &__stage-lock {
    flex-shrink: 0;
    color: var(--light-text-backgroung-primary-50);
  }
  &__stage-actions {
    @include flex(rn, a-center);
    position: relative;
    flex-shrink: 0;
  }
  &__stage-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 20;
    width: 224px;
    padding: 4px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    background: var(--dark-text-background-primary);
    button {
      @include flex(rn, a-center);
      gap: 8px;
      width: 100%;
      min-height: 40px;
      padding: 8px 12px;
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary);
      background: transparent;
      border: 0;
      border-radius: 8px;
      text-align: left;
      justify-content: flex-start;
      svg {
        flex-shrink: 0;
      }
      cursor: pointer;
      &:hover:not(:disabled) {
        background: var(--light-text-backgroung-primary-5);
      }
      &:disabled {
        opacity: 0.4;
        cursor: default;
      }
    }
    button.kanban__stage-delete {
      color: var(--danger-delete);
      border-top: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 0 0 8px 8px;
    }
  }
  &__stage-header button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  &__column_stage-dragging {
    opacity: 0.35;
  }
  &__stage-placeholder {
    @include flex(cn, a-center, j-start);
    gap: 8px;
    flex: 0 0 290px;
    min-width: 290px;
    margin: 0 8px;
    padding: 24px 16px;
    height: calc(100% - 8px);
    border: 1px dashed var(--primary);
    border-radius: 12px;
    background: var(--primary-10, var(--light-text-backgroung-primary-5));
    color: var(--light-text-backgroung-primary);
    pointer-events: auto;
    text-align: center;
    overflow-wrap: anywhere;
    strong {
      @extend %text-s-medium;
    }
    span {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
    }
    svg {
      color: var(--primary);
    }
  }

  &_dragging {
    cursor: grabbing;
    user-select: none;

    * {
      cursor: grabbing !important;
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

  &__create-btn,
  &__collapse-btn {
    @include flex(center);
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 4px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-10);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    @media (pointer: coarse) {
      width: 44px;
      height: 44px;
    }
  }

  &__create-btn {
    margin-left: auto;

    :deep(svg) {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    &_active {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-10);
    }

    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__quick-create {
    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__column-header {
    width: 100%;
    min-width: 0;
    flex-shrink: 0;

    @include flex(a-center);
    gap: 8px;
    border-radius: 12px;

    @extend %text-l-regular;
    color: var(--light-text-backgroung-primary);

    &_dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    &_open,
    &_backlog {
      background: var(--light-text-backgroung-primary);
    }

    &_archive {
      background: var(--light-text-backgroung-primary-50);
    }

    &_to_do {
      background: var(--status-blue);
    }

    &_in_progress {
      background: var(--status-in-progress);
    }

    &_waiting {
      background: var(--status-waiting);
    }

    &_in_review {
      background: var(--status-violet);
    }

    &_control {
      background: var(--status-indigo);
    }

    &_closed {
      background: var(--green);
    }

    &_count {
      flex-shrink: 0;
      @extend %text-xs-light;
      color: var(--light-text-backgroung-primary-50);
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

  &__column-status {
    position: relative;
    min-width: 0;
    @include flex(rn, a-center);
    gap: 8px;
    border-radius: 6px;
    cursor: help;
    outline: none;

    &:hover .kanban__status-tooltip,
    &:focus-visible .kanban__status-tooltip {
      opacity: 1;
      visibility: visible;
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }

    @media (pointer: coarse) {
      min-height: 44px;
    }
  }

  &__status-tooltip {
    @include flex(cn);
    gap: 6px;
    position: absolute;
    z-index: 30;
    top: calc(100% + 8px);
    left: 0;
    width: 272px;
    padding: 8px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-secondary);
    box-shadow: 0 8px 24px var(--black-40);
    color: var(--light-text-backgroung-primary);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    @extend %text-xs-regular;
    transition:
      opacity 0.15s ease,
      visibility 0.15s ease;

    strong {
      font-weight: 600;
    }
  }

  &__status-tooltip-section {
    display: block;
  }

  &__column-header_title {
    min-width: 0;
    overflow-wrap: anywhere;
    @extend %text-l-regular;
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
    width: 100%;
    min-width: 0;
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
    &_project {
      @extend %p12-medium;
      color: var(--light-text-backgroung-primary-50);
    }

    &_users {
      margin-left: auto;
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

    &-status {
      float: left;
      margin-right: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
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

    &-flag {
      flex-shrink: 0;
      color: var(--danger-delete);
    }
  }

  &__project-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
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
  @media (max-width: $screen-tablet) {
    &__stage-icon {
      flex-basis: 36px;
      height: 44px;
    }
    &__stage-name_editable svg {
      opacity: 1;
    }
    &__stage-menu button {
      min-height: 44px;
    }
  }
}

.kanban-context-menu {
  position: fixed;
  z-index: 2100;
  width: 216px;
  padding: 4px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  background: var(--dark-text-background-primary);
  box-shadow: 0 8px 24px var(--black-40);

  button {
    @include flex(rn, a-center, j-start);
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 8px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    text-align: left;
    cursor: pointer;
    @extend %text-s-regular;

    svg {
      flex-shrink: 0;
    }

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__delete {
    color: var(--danger-delete) !important;
  }

  @media (max-width: $screen-tablet) {
    button {
      min-height: 44px;
    }
  }
}

.kanban-deadline-picker {
  position: fixed;
  z-index: 2100;
  box-sizing: border-box;
  width: 292px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  outline: none;
  background: var(--dark-text-background-primary);
  box-shadow: 0 8px 24px var(--black-40);

  &__header {
    @include flex(rn between a-start);
    gap: 12px;
    margin-bottom: 8px;

    div {
      min-width: 0;
      @include flex(cn);
      gap: 2px;
    }

    strong {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-medium;
    }

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }

    button {
      @include flex(center);
      flex: 0 0 40px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--light-text-backgroung-primary-50);
      cursor: pointer;

      &:hover {
        background: var(--light-text-backgroung-primary-5);
        color: var(--light-text-backgroung-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }
    }
  }

  &__remove {
    width: 100%;
    min-height: 40px;
    margin-top: 8px;
    padding: 8px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--danger-delete);
    cursor: pointer;
    @extend %text-s-medium;

    &:hover:not(:disabled) {
      background: var(--danger-delete-25);
    }

    &:focus-visible {
      outline: 2px solid var(--danger-delete);
      outline-offset: -2px;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  @media (max-width: $screen-tablet) {
    &__header button,
    &__remove {
      min-height: 44px;
    }
  }
}

.kanban-action-modal {
  box-sizing: border-box;
  width: 100%;
  @include flex(cn);
  gap: 24px;

  &__header {
    @include flex(cn);
    gap: 4px;

    h2 {
      margin: 0;
      color: var(--light-text-backgroung-primary);
      @extend %text-l-bold;
    }

    p {
      margin: 0;
      color: var(--light-text-backgroung-primary-50);
      overflow-wrap: anywhere;
      @extend %text-s-regular;
    }
  }

  &__field {
    @include flex(cn);
    gap: 8px;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;

    small {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }

    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 112px;
      padding: 10px 12px;
      resize: vertical;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      outline: none;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }

      &:focus-visible {
        border-color: var(--primary-50);
        outline: 2px solid var(--primary-25);
      }
    }
  }

  &__buttons {
    @include flex(rn);
    gap: 8px;

    button {
      flex: 1;
      min-height: 40px;
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
      cursor: pointer;
      @extend %text-s-medium;

      &:hover:not(:disabled) {
        background: var(--primary-hover);
      }

      &:focus-visible {
        outline: 2px solid var(--light-text-backgroung-primary);
        outline-offset: 2px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }

  &__buttons &__secondary {
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);

    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__buttons &__danger {
    background: var(--danger-delete);

    &:hover:not(:disabled) {
      background: var(--danger-delete-50);
    }
  }

  @media (max-width: $screen-mobile-l) {
    &__field textarea {
      font-size: 16px;
    }

    &__buttons button {
      min-height: 44px;
    }
  }
}
</style>
