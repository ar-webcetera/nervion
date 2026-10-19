<script setup lang="ts">
import type { CalendarEvent, CreateCalendarEventRequest } from '@tracker/contracts';
import {
  addDays,
  addWeeks,
  differenceInMinutes,
  eachDayOfInterval,
  endOfDay,
  format,
  isSameDay,
  isToday,
  max,
  min,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, GripVertical, Users } from '@lucide/vue';
import { ROLES } from '~/types/user';

definePageMeta({ middleware: 'auth', name: 'calendar' });

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const HOUR_HEIGHT = 72;
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
const EVENT_COLORS = ['#cb7d58', '#4f8f84', '#6f82b8', '#a26f9c', '#9a8148', '#5f8fa8'];

interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  color: string;
}

interface DragPreview {
  event: CalendarEvent;
  day: Date;
  start: Date;
  end: Date;
  top: number;
  height: number;
}

const calendarStore = useCalendarStore();
const userStore = useUserStore();
const route = useRoute();
const router = useRouter();
const { $toast } = useNuxtApp();

const weekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }));
const activeMobileDay = ref(new Date());
const isMobile = ref(false);
const detailsOpen = ref(false);
const editorOpen = ref(false);
const selectedEvent = ref<CalendarEvent | null>(null);
const initialStart = ref<Date | null>(null);
const initialEnd = ref<Date | null>(null);
const modalRef = ref<{ setSaving: (value: boolean) => void; setError: (message: string) => void } | null>(null);
const scrollArea = ref<HTMLElement | null>(null);
const draggingEvent = ref<CalendarEvent | null>(null);
const dragPreview = ref<DragPreview | null>(null);
const movingEventId = ref<number | null>(null);
const acceptingEventId = ref<number | null>(null);
let dragGrabOffsetMinutes = 0;
let draggedEventId: number | null = null;
let mediaQuery: MediaQueryList | null = null;
let routeEventRequestId = 0;
let isRouteSyncReady = false;
const syncMobile = () => {
  isMobile.value = Boolean(mediaQuery?.matches);
};

const days = computed(() => eachDayOfInterval({ start: weekStart.value, end: addDays(weekStart.value, 6) }));
const displayedDays = computed(() => (isMobile.value ? [activeMobileDay.value] : days.value));
const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => DAY_START_HOUR + index);
const weekLabel = computed(() => {
  const end = addDays(weekStart.value, 6);
  return `${format(weekStart.value, 'd MMM', { locale: ru })} - ${format(end, 'd MMM yyyy', { locale: ru })}`;
});
const currentUserId = computed(() => userStore.user?.id ?? 0);
const canEditSelected = computed(
  () => !selectedEvent.value || selectedEvent.value.creator_id === currentUserId.value || userStore.user?.role === ROLES.admin,
);
const canManageEvent = (event: CalendarEvent) => event.creator_id === currentUserId.value || userStore.user?.role === ROLES.admin;
const gridHeight = `${(DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT}px`;

const fetchWeek = () => {
  const from = startOfDay(weekStart.value).toISOString();
  const to = startOfDay(addDays(weekStart.value, 7)).toISOString();
  return calendarStore.fetchEvents(from, to);
};

await useAsyncData('calendar-initial', () => Promise.all([fetchWeek(), calendarStore.fetchUsers()]));

const setWeek = async (date: Date) => {
  weekStart.value = startOfWeek(date, { weekStartsOn: 1 });
  if (!days.value.some((day) => isSameDay(day, activeMobileDay.value))) activeMobileDay.value = weekStart.value;
  try {
    await fetchWeek();
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
};

const goPrevious = () => setWeek(addWeeks(weekStart.value, -1));
const goNext = () => setWeek(addWeeks(weekStart.value, 1));
const goToday = () => {
  activeMobileDay.value = new Date();
  return setWeek(new Date());
};

const getEventsForDay = (day: Date): PositionedEvent[] => {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const viewStart = new Date(dayStart);
  viewStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const viewEnd = new Date(dayStart);
  viewEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  const events = calendarStore.events
    .filter((event) => parseISO(event.start_at) <= dayEnd && parseISO(event.end_at) >= dayStart)
    .map((event) => ({ event, start: max([parseISO(event.start_at), viewStart]), end: min([parseISO(event.end_at), viewEnd]) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

  const columnEnds: number[] = [];
  const positioned = events.map(({ event, start, end }) => {
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start.getTime());
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = end.getTime();
    return { event, start, end, column };
  });
  const columnCount = Math.max(columnEnds.length, 1);

  return positioned.map(({ event, start, end, column }) => ({
    event,
    top: (differenceInMinutes(start, viewStart) / TOTAL_MINUTES) * 100,
    height: Math.max((differenceInMinutes(end, start) / TOTAL_MINUTES) * 100, 2.5),
    left: (column / columnCount) * 100,
    width: 100 / columnCount,
    color: EVENT_COLORS[event.id % EVENT_COLORS.length]!,
  }));
};

const getEventStyle = (positioned: PositionedEvent) => ({
  top: `${positioned.top}%`,
  height: `${positioned.height}%`,
  left: `calc(${positioned.left}% + 3px)`,
  width: `calc(${positioned.width}% - 6px)`,
  '--event-color': positioned.color,
});

const getDragPreviewStyle = (preview: DragPreview) => ({
  top: `${preview.top}%`,
  height: `${preview.height}%`,
  '--event-color': EVENT_COLORS[preview.event.id % EVENT_COLORS.length],
});

const calculateDragPreview = (day: Date, clientY: number, column: HTMLElement): DragPreview | null => {
  const event = draggingEvent.value;
  if (!event) return null;

  const duration = differenceInMinutes(parseISO(event.end_at), parseISO(event.start_at));
  if (duration <= 0) return null;

  const rect = column.getBoundingClientRect();
  const pointerRatio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
  const pointerMinutes = pointerRatio * TOTAL_MINUTES;
  const maxStartMinutes = Math.max(TOTAL_MINUTES - duration, 0);
  const startMinutes = Math.min(Math.max(Math.round((pointerMinutes - dragGrabOffsetMinutes) / 15) * 15, 0), maxStartMinutes);
  const start = new Date(day);
  start.setHours(DAY_START_HOUR, startMinutes, 0, 0);
  const end = new Date(start.getTime() + duration * 60_000);

  return {
    event,
    day,
    start,
    end,
    top: (startMinutes / TOTAL_MINUTES) * 100,
    height: Math.max((duration / TOTAL_MINUTES) * 100, 2.5),
  };
};

const scrollDuringDrag = (clientY: number) => {
  const element = scrollArea.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const edge = 52;
  if (clientY < rect.top + edge) element.scrollTop -= 18;
  else if (clientY > rect.bottom - edge) element.scrollTop += 18;
};

const handleEventDragStart = (event: CalendarEvent, pointerEvent: DragEvent) => {
  if (pointerEvent.target instanceof Element && pointerEvent.target.closest('.calendar-event-actions')) {
    pointerEvent.preventDefault();
    return;
  }
  if (isMobile.value || !canManageEvent(event) || movingEventId.value !== null) {
    pointerEvent.preventDefault();
    return;
  }

  const card = pointerEvent.currentTarget;
  if (!(card instanceof HTMLElement)) return;
  const duration = Math.max(differenceInMinutes(parseISO(event.end_at), parseISO(event.start_at)), 1);
  const rect = card.getBoundingClientRect();
  dragGrabOffsetMinutes = Math.min(
    Math.max(((pointerEvent.clientY - rect.top) / Math.max(rect.height, 1)) * duration, 0),
    duration,
  );
  draggingEvent.value = event;
  draggedEventId = event.id;
  pointerEvent.dataTransfer?.setData('text/plain', String(event.id));
  if (pointerEvent.dataTransfer) pointerEvent.dataTransfer.effectAllowed = 'move';
};

const handleEventDragOver = (day: Date, pointerEvent: DragEvent) => {
  if (!draggingEvent.value) return;
  pointerEvent.preventDefault();
  if (pointerEvent.dataTransfer) pointerEvent.dataTransfer.dropEffect = 'move';
  const column = pointerEvent.currentTarget;
  if (!(column instanceof HTMLElement)) return;
  scrollDuringDrag(pointerEvent.clientY);
  dragPreview.value = calculateDragPreview(day, pointerEvent.clientY, column);
};

const resetDrag = () => {
  draggingEvent.value = null;
  dragPreview.value = null;
  dragGrabOffsetMinutes = 0;
  window.setTimeout(() => {
    draggedEventId = null;
  }, 0);
};

const handleEventDrop = async (pointerEvent: DragEvent) => {
  pointerEvent.preventDefault();
  const preview = dragPreview.value;
  if (!preview || movingEventId.value !== null) {
    resetDrag();
    return;
  }

  const previousStart = parseISO(preview.event.start_at);
  const previousEnd = parseISO(preview.event.end_at);
  if (preview.start.getTime() === previousStart.getTime() && preview.end.getTime() === previousEnd.getTime()) {
    resetDrag();
    return;
  }

  movingEventId.value = preview.event.id;
  try {
    await calendarStore.updateEvent(preview.event.id, {
      start_at: preview.start.toISOString(),
      end_at: preview.end.toISOString(),
    });
    $toast.success('Встреча перенесена');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    movingEventId.value = null;
    resetDrag();
  }
};

const handleEventClick = (event: CalendarEvent) => {
  if (draggedEventId === event.id) return;
  openEventDetails(event);
};

const openNewAt = (start: Date) => {
  const rounded = new Date(start);
  rounded.setMinutes(Math.round(rounded.getMinutes() / 15) * 15, 0, 0);
  initialStart.value = rounded;
  initialEnd.value = new Date(rounded.getTime() + 60 * 60 * 1000);
  selectedEvent.value = null;
  detailsOpen.value = false;
  editorOpen.value = true;
};

const openNewDefault = () => {
  const now = new Date();
  const base = isMobile.value ? new Date(activeMobileDay.value) : now;
  if (!isSameDay(base, now)) base.setHours(10, 0, 0, 0);
  else base.setMinutes(Math.ceil(base.getMinutes() / 15) * 15, 0, 0);
  if (base.getHours() < DAY_START_HOUR || base.getHours() >= DAY_END_HOUR) base.setHours(10, 0, 0, 0);
  openNewAt(base);
};

const handleDayClick = (day: Date, event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
  const minutes = Math.round((ratio * TOTAL_MINUTES) / 15) * 15;
  const start = new Date(day);
  start.setHours(DAY_START_HOUR, minutes, 0, 0);
  openNewAt(start);
};

const showEventDetails = (event: CalendarEvent) => {
  selectedEvent.value = event;
  initialStart.value = null;
  initialEnd.value = null;
  editorOpen.value = false;
  detailsOpen.value = true;
};

const getRouteEventId = (value: string | (string | null)[] | null | undefined): number | null => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const eventId = Number(rawValue);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
};

const openEventFromRoute = async (value: string | (string | null)[] | null | undefined) => {
  const eventId = getRouteEventId(value);
  if (!eventId || ((detailsOpen.value || editorOpen.value) && selectedEvent.value?.id === eventId)) return;

  const requestId = ++routeEventRequestId;
  try {
    const event = await calendarStore.fetchEvent(eventId);
    if (requestId !== routeEventRequestId) return;

    const eventDate = parseISO(event.start_at);
    activeMobileDay.value = eventDate;
    await setWeek(eventDate);
    if (requestId !== routeEventRequestId) return;

    showEventDetails(event);
  } catch (error) {
    if (requestId === routeEventRequestId) $toast.error(getErrorMessage(error));
  }
};

const openEventDetails = (event: CalendarEvent) => {
  showEventDetails(event);
  if (getRouteEventId(route.query['event-id']) !== event.id) {
    void router.replace({ query: { ...route.query, 'event-id': String(event.id) } });
  }
};

const openEventEditor = (event: CalendarEvent) => {
  selectedEvent.value = event;
  initialStart.value = null;
  initialEnd.value = null;
  detailsOpen.value = false;
  editorOpen.value = true;
  if (getRouteEventId(route.query['event-id']) !== event.id) {
    void router.replace({ query: { ...route.query, 'event-id': String(event.id) } });
  }
};

const closeEventDialogs = () => {
  routeEventRequestId += 1;
  detailsOpen.value = false;
  editorOpen.value = false;
  selectedEvent.value = null;
  initialStart.value = null;
  initialEnd.value = null;
  if (route.query['event-id'] !== undefined) {
    const { ['event-id']: _eventId, ...query } = route.query;
    void router.replace({ query });
  }
};

const updateDetailsOpen = (value: boolean) => {
  if (value) detailsOpen.value = true;
  else closeEventDialogs();
};

const updateEditorOpen = (value: boolean) => {
  if (value) editorOpen.value = true;
  else closeEventDialogs();
};

const saveEvent = async (data: CreateCalendarEventRequest) => {
  try {
    const wasEditing = Boolean(selectedEvent.value);
    if (selectedEvent.value) await calendarStore.updateEvent(selectedEvent.value.id, data);
    else await calendarStore.createEvent(data);
    modalRef.value?.setSaving(false);
    closeEventDialogs();
    $toast.success(wasEditing ? 'Встреча обновлена' : 'Встреча добавлена');
    await fetchWeek();
  } catch (error) {
    modalRef.value?.setSaving(false);
    modalRef.value?.setError(getErrorMessage(error));
  }
};

const deleteEvent = async () => {
  if (!selectedEvent.value) return;
  if (!window.confirm(`Удалить встречу "${selectedEvent.value.title}"? Участники больше не получат напоминание.`)) return;
  modalRef.value?.setSaving(true);
  try {
    await calendarStore.deleteEvent(selectedEvent.value.id);
    closeEventDialogs();
    $toast.success('Встреча удалена');
  } catch (error) {
    modalRef.value?.setSaving(false);
    modalRef.value?.setError(getErrorMessage(error));
  }
};

const acceptEvent = async () => {
  if (!selectedEvent.value || acceptingEventId.value !== null) return;
  acceptingEventId.value = selectedEvent.value.id;
  try {
    selectedEvent.value = await calendarStore.acceptEvent(selectedEvent.value.id);
    $toast.success('Участие подтверждено');
  } catch (error) {
    $toast.error(getErrorMessage(error));
  } finally {
    acceptingEventId.value = null;
  }
};

const eventTime = (event: CalendarEvent) =>
  `${format(parseISO(event.start_at), 'HH:mm')} - ${format(parseISO(event.end_at), 'HH:mm')}`;

const currentTimeTop = computed(() => {
  const now = new Date();
  const minutes = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
  return Math.min(Math.max((minutes / TOTAL_MINUTES) * 100, 0), 100);
});

watch(
  () => route.query['event-id'],
  (value, previousValue) => {
    if (!isRouteSyncReady) return;

    const eventId = getRouteEventId(value);
    if (eventId) {
      void openEventFromRoute(value);
      return;
    }

    if (getRouteEventId(previousValue)) {
      routeEventRequestId += 1;
      detailsOpen.value = false;
      editorOpen.value = false;
      selectedEvent.value = null;
      initialStart.value = null;
      initialEnd.value = null;
    }
  },
);

onMounted(async () => {
  mediaQuery = window.matchMedia('(max-width: 767px)');
  syncMobile();
  mediaQuery.addEventListener('change', syncMobile);
  await nextTick();
  if (scrollArea.value) scrollArea.value.scrollTop = HOUR_HEIGHT;
  try {
    await Promise.all([fetchWeek(), calendarStore.fetchUsers()]);
  } catch (error) {
    $toast.error(getErrorMessage(error));
  }
  isRouteSyncReady = true;
  await openEventFromRoute(route.query['event-id']);
});

onBeforeUnmount(() => mediaQuery?.removeEventListener('change', syncMobile));
</script>

<template>
  <main class="calendar-page">
    <header class="calendar-page__header">
      <h1>Календарь</h1>
      <div class="calendar-page__actions">
        <button type="button" class="calendar-page__nav-button" aria-label="Предыдущая неделя" @click="goPrevious">
          <ChevronLeft :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <span class="calendar-page__week-label">{{ weekLabel }}</span>
        <button type="button" class="calendar-page__nav-button" aria-label="Следующая неделя" @click="goNext">
          <ChevronRight :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
        <button type="button" class="calendar-page__today" @click="goToday">Сегодня</button>
        <button type="button" class="calendar-page__create" @click="openNewDefault">
          <CalendarPlus :size="18" :stroke-width="1.75" aria-hidden="true" />
          Добавить встречу
        </button>
      </div>
    </header>

    <div class="calendar-page__mobile-days" aria-label="Дни недели">
      <button
        v-for="day in days"
        :key="day.toISOString()"
        type="button"
        :class="{ 'calendar-page__mobile-day_active': isSameDay(day, activeMobileDay) }"
        @click="activeMobileDay = day"
      >
        <span>{{ format(day, 'EEEEEE', { locale: ru }) }}</span>
        <strong>{{ format(day, 'd') }}</strong>
      </button>
    </div>

    <section class="calendar-page__calendar" aria-label="Календарь встреч">
      <div class="calendar-page__day-head" :style="{ '--day-count': displayedDays.length }">
        <div class="calendar-page__head-corner" />
        <div
          v-for="day in displayedDays"
          :key="day.toISOString()"
          class="calendar-page__day-title"
          :class="{ 'calendar-page__day-title_today': isToday(day) }"
        >
          <span>{{ format(day, 'EEEEEE', { locale: ru }) }}</span>
          <strong>{{ format(day, 'd MMM', { locale: ru }) }}</strong>
        </div>
      </div>

      <div ref="scrollArea" class="calendar-page__scroll">
        <div class="calendar-page__body">
          <div class="calendar-page__time-axis" :style="{ height: gridHeight }" aria-hidden="true">
            <span v-for="hour in hours" :key="hour" :style="{ top: `${(hour - DAY_START_HOUR) * HOUR_HEIGHT}px` }">
              {{ String(hour).padStart(2, '0') }}:00
            </span>
          </div>

          <div class="calendar-page__days" :style="{ height: gridHeight, '--day-count': displayedDays.length }">
            <div
              v-for="day in displayedDays"
              :key="day.toISOString()"
              class="calendar-page__day-column"
              :class="{
                'calendar-page__day-column_today': isToday(day),
                'calendar-page__day-column_drop': dragPreview && isSameDay(day, dragPreview.day),
              }"
              @click="handleDayClick(day, $event)"
              @dragover="handleEventDragOver(day, $event)"
              @drop.stop="handleEventDrop"
            >
              <div
                v-if="isToday(day)"
                class="calendar-page__now-line"
                :style="{ top: `${currentTimeTop}%` }"
                aria-hidden="true"
              />
              <div
                v-for="positioned in getEventsForDay(day)"
                :key="positioned.event.id"
                class="calendar-page__event"
                :class="{
                  'calendar-page__event_draggable': !isMobile && canManageEvent(positioned.event),
                  'calendar-page__event_manageable': canManageEvent(positioned.event),
                  'calendar-page__event_dragging': draggingEvent?.id === positioned.event.id,
                  'calendar-page__event_moving': movingEventId === positioned.event.id,
                }"
                :style="getEventStyle(positioned)"
                role="button"
                tabindex="0"
                :aria-label="`${positioned.event.title}, ${eventTime(positioned.event)}`"
                :aria-disabled="movingEventId === positioned.event.id"
                :draggable="!isMobile && canManageEvent(positioned.event) && movingEventId === null"
                :title="!isMobile && canManageEvent(positioned.event) ? 'Перетащите, чтобы изменить день или время' : undefined"
                @click.stop="handleEventClick(positioned.event)"
                @keydown.enter.stop="handleEventClick(positioned.event)"
                @keydown.space.prevent.stop="handleEventClick(positioned.event)"
                @dragstart.stop="handleEventDragStart(positioned.event, $event)"
                @dragend.stop="resetDrag"
              >
                <GripVertical
                  v-if="!isMobile && canManageEvent(positioned.event)"
                  class="calendar-page__event-grip"
                  :size="14"
                  :stroke-width="1.75"
                  aria-hidden="true"
                />
                <strong>{{ positioned.event.title }}</strong>
                <span><Clock3 :size="13" aria-hidden="true" />{{ eventTime(positioned.event) }}</span>
                <span v-if="positioned.event.participants.length">
                  <Users :size="13" aria-hidden="true" />{{ positioned.event.participants.length }}
                </span>
                <CalendarEventActions
                  v-if="canManageEvent(positioned.event)"
                  :event="positioned.event"
                  @edit="openEventEditor(positioned.event)"
                />
              </div>
              <div
                v-if="dragPreview && isSameDay(day, dragPreview.day)"
                class="calendar-page__drag-preview"
                :style="getDragPreviewStyle(dragPreview)"
                aria-hidden="true"
              >
                <strong>{{ dragPreview.event.title }}</strong>
                <span>
                  <Clock3 :size="13" />
                  {{ format(dragPreview.start, 'HH:mm') }} - {{ format(dragPreview.end, 'HH:mm') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="calendarStore.loading" class="calendar-page__loading" aria-live="polite">Обновляем календарь...</div>
      <div v-else-if="!calendarStore.events.length" class="calendar-page__empty">
        <CalendarPlus :size="28" :stroke-width="1.5" aria-hidden="true" />
        <strong>На этой неделе встреч нет</strong>
        <span>Нажмите на свободное время или добавьте встречу кнопкой сверху.</span>
      </div>
    </section>

    <CalendarEventDetailsModal
      :model-value="detailsOpen"
      :event="selectedEvent"
      :current-user-id="currentUserId"
      :accepting="acceptingEventId === selectedEvent?.id"
      @update:model-value="updateDetailsOpen"
      @accept="acceptEvent"
    />

    <CalendarEventModal
      ref="modalRef"
      :model-value="editorOpen"
      :event="selectedEvent"
      :users="calendarStore.users"
      :initial-start="initialStart"
      :initial-end="initialEnd"
      :current-user-id="currentUserId"
      :editable="canEditSelected"
      @update:model-value="updateEditorOpen"
      @save="saveEvent"
      @delete="deleteEvent"
    />
  </main>
</template>

<style scoped lang="scss">
.calendar-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 20px;
  @include flex(cn);
  gap: 16px;
  color: var(--light-text-backgroung-primary);
  background: var(--dark-text-background-primary);

  &__header {
    min-width: 0;
    @include flex(rn, a-center);
    justify-content: space-between;
    gap: 20px;

    h1 {
      margin: 0;
      @extend %display-s-medium;
    }
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__nav-button,
  &__today,
  &__create {
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: 2px;
    }
  }

  &__nav-button {
    width: 44px;
    padding: 0;
    background: var(--light-text-backgroung-primary-5);
    @include flex(center);
  }

  &__week-label {
    min-width: 168px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    @extend %text-s-medium;
  }

  &__today {
    padding: 0 14px;
    background: var(--light-text-backgroung-primary-5);
    @extend %text-s-medium;
  }

  &__create {
    padding: 0 16px;
    background: var(--primary);
    @include flex(rn, a-center);
    gap: 8px;
    @extend %text-s-medium;
  }

  &__mobile-days {
    display: none;
  }

  &__calendar {
    position: relative;
    min-height: 0;
    flex: 1;
    overflow: hidden;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    background: color-mix(in srgb, var(--dark-text-background-primary) 94%, white);
  }

  &__day-head {
    display: grid;
    grid-template-columns: 64px repeat(var(--day-count), minmax(120px, 1fr));
    min-width: calc(64px + var(--day-count) * 120px);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);
  }

  &__head-corner {
    border-right: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__day-title {
    min-height: 58px;
    padding: 8px 10px;
    @include flex(cn, center);
    gap: 2px;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary-50);

    span {
      @extend %text-xs-regular;
    }

    strong {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-medium;
    }

    &_today strong {
      color: color-mix(in srgb, var(--primary) 70%, white);
    }
  }

  &__scroll {
    height: calc(100% - 59px);
    overflow: auto;
    overscroll-behavior: contain;
  }

  &__body {
    display: grid;
    grid-template-columns: 64px minmax(840px, 1fr);
    min-width: 904px;
  }

  &__time-axis {
    position: relative;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);

    span {
      position: absolute;
      right: 10px;
      transform: translateY(-50%);
      color: var(--light-text-backgroung-primary-50);
      font-variant-numeric: tabular-nums;
      @extend %text-xs-regular;
    }
  }

  &__days {
    display: grid;
    grid-template-columns: repeat(var(--day-count), minmax(120px, 1fr));
  }

  &__day-column {
    position: relative;
    min-width: 0;
    border-right: 1px solid var(--light-text-backgroung-primary-10);
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent calc(72px - 1px),
      var(--light-text-backgroung-primary-10) calc(72px - 1px),
      var(--light-text-backgroung-primary-10) 72px
    );
    cursor: crosshair;

    &_today {
      background-color: color-mix(in srgb, var(--primary) 3%, transparent);
    }

    &_drop {
      background-color: color-mix(in srgb, var(--primary) 8%, transparent);
    }
  }

  &__event {
    position: absolute;
    z-index: 2;
    min-height: 28px;
    padding: 7px 8px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--event-color) 75%, white);
    border-left: 3px solid var(--event-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--event-color) 28%, var(--dark-text-background-primary));
    color: var(--light-text-backgroung-primary);
    text-align: left;
    cursor: pointer;
    @include flex(cn);
    gap: 3px;

    &_draggable {
      padding-left: 22px;
      cursor: grab;

      &:active {
        cursor: grabbing;
      }
    }

    &_manageable {
      padding-right: 32px;
    }

    &_dragging {
      opacity: 0.3;
    }

    &_moving {
      opacity: 0.55;
      cursor: wait;
    }

    &:hover {
      z-index: 3;
      background: color-mix(in srgb, var(--event-color) 38%, var(--dark-text-background-primary));
    }

    &:focus-visible {
      z-index: 4;
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: -3px;
    }

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      @extend %text-xs-medium;
    }

    span {
      overflow: hidden;
      @include flex(rn, a-center);
      gap: 4px;
      color: color-mix(in srgb, var(--light-text-backgroung-primary) 78%, var(--event-color));
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      @extend %text-xs-regular;
    }
  }

  &__event-grip {
    position: absolute;
    top: 7px;
    left: 5px;
    color: var(--light-text-backgroung-primary-50);
  }

  &__drag-preview {
    position: absolute;
    z-index: 6;
    left: 3px;
    right: 3px;
    min-height: 28px;
    padding: 7px 8px;
    overflow: hidden;
    border: 1px dashed color-mix(in srgb, var(--event-color) 80%, white);
    border-left: 3px solid var(--event-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--event-color) 42%, var(--dark-text-background-primary));
    color: var(--light-text-backgroung-primary);
    pointer-events: none;
    @include flex(cn);
    gap: 3px;

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      @extend %text-xs-medium;
    }

    span {
      @include flex(rn, a-center);
      gap: 4px;
      color: var(--light-text-backgroung-primary-50);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      @extend %text-xs-regular;
    }
  }

  &__now-line {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    height: 1px;
    background: #e9785d;
    pointer-events: none;

    &::before {
      content: '';
      position: absolute;
      left: -4px;
      top: -4px;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #e9785d;
    }
  }

  &__loading,
  &__empty {
    position: absolute;
    z-index: 10;
    left: 50%;
    transform: translateX(-50%);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 10px;
    background: color-mix(in srgb, var(--dark-text-background-primary) 92%, transparent);
    backdrop-filter: blur(10px);
  }

  &__loading {
    top: 76px;
    padding: 9px 12px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__empty {
    top: 50%;
    width: min(340px, calc(100% - 32px));
    padding: 20px;
    @include flex(cn, center);
    gap: 7px;
    text-align: center;
    pointer-events: none;

    strong {
      @extend %text-m-medium;
    }

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-regular;
    }
  }

  @media (max-width: $screen-mobile-l) {
    height: 100%;
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    gap: 12px;

    &__header {
      align-items: flex-start;
      flex-direction: column;
      gap: 12px;
    }

    &__actions {
      width: 100%;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) 44px auto;
    }

    &__week-label {
      min-width: 0;
      font-size: 12px;
    }

    &__today {
      padding: 0 12px;
    }

    &__create {
      position: fixed;
      z-index: 20;
      right: 16px;
      bottom: calc(76px + env(safe-area-inset-bottom));
      width: 52px;
      min-height: 52px;
      padding: 0;
      border-radius: 999px;
      justify-content: center;
      box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
      font-size: 0;
    }

    &__mobile-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;

      button {
        min-width: 0;
        min-height: 48px;
        padding: 5px 2px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--light-text-backgroung-primary-50);
        @include flex(cn, center);

        span {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 400;
          line-height: 16px;
        }

        strong {
          color: var(--light-text-backgroung-primary);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          line-height: 20px;
        }
      }
    }

    &__mobile-day_active {
      background: color-mix(in srgb, var(--primary) 18%, transparent) !important;
    }

    &__day-head {
      grid-template-columns: 54px minmax(0, 1fr);
      min-width: 0;
    }

    &__day-title {
      min-height: 50px;
    }

    &__scroll {
      height: calc(100% - 51px);
    }

    &__body {
      grid-template-columns: 54px minmax(0, 1fr);
      min-width: 0;
    }

    &__days {
      grid-template-columns: minmax(0, 1fr);
    }

    &__time-axis span {
      right: 7px;
    }

    &__event {
      padding: 6px 8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto !important;
    }
  }
}
</style>
