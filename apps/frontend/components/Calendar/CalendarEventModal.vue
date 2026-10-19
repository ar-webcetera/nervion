<script setup lang="ts">
import type { CalendarEvent, CalendarUser, CreateCalendarEventRequest } from '@tracker/contracts';
import { format } from 'date-fns';
import { Bell, Link2, Mail, Trash2 } from '@lucide/vue';
import type { SelectOption } from '~/types/select';

const props = defineProps<{
  modelValue: boolean;
  event?: CalendarEvent | null;
  users: CalendarUser[];
  initialStart?: Date | null;
  initialEnd?: Date | null;
  currentUserId: number;
  editable: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'save', value: CreateCalendarEventRequest): void;
  (event: 'delete' | 'close'): void;
}>();

const reminderOptions: SelectOption[] = [
  { value: 0, label: 'В момент начала' },
  { value: 5, label: 'За 5 минут' },
  { value: 15, label: 'За 15 минут' },
  { value: 30, label: 'За 30 минут' },
  { value: 60, label: 'За 1 час' },
  { value: 1440, label: 'За 1 день' },
];

const timeOptions: SelectOption[] = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4)
    .toString()
    .padStart(2, '0');
  const minutes = ((index % 4) * 15).toString().padStart(2, '0');
  const value = `${hours}:${minutes}`;
  return { value, label: value };
});

const form = reactive({
  title: '',
  notes: '',
  meetingUrl: '',
  date: null as Date | string | null,
  startTime: '10:00',
  endTime: '11:00',
  reminderMinutes: 15,
  participantIds: [] as number[],
});
const saving = ref(false);
const errorMessage = ref('');
const errorSummary = ref<HTMLElement | null>(null);

const organizerId = computed(() => props.event?.creator_id ?? props.currentUserId);
const isEditing = computed(() => Boolean(props.event));
const startTimeValue = computed<string | number | null>({
  get: () => form.startTime,
  set: (value) => {
    if (typeof value === 'string') form.startTime = value;
  },
});
const endTimeValue = computed<string | number | null>({
  get: () => form.endTime,
  set: (value) => {
    if (typeof value === 'string') form.endTime = value;
  },
});
const reminderValue = computed<string | number | null>({
  get: () => form.reminderMinutes,
  set: (value) => {
    if (typeof value === 'number') form.reminderMinutes = value;
  },
});

const toTime = (date: Date) => format(date, 'HH:mm');

const resetForm = () => {
  const start = props.event ? new Date(props.event.start_at) : (props.initialStart ?? new Date());
  const end = props.event ? new Date(props.event.end_at) : (props.initialEnd ?? new Date(start.getTime() + 60 * 60 * 1000));
  form.title = props.event?.title ?? '';
  form.notes = props.event?.notes ?? '';
  form.meetingUrl = props.event?.meeting_url ?? '';
  form.date = start;
  form.startTime = toTime(start);
  form.endTime = toTime(end);
  form.reminderMinutes = props.event?.reminder_minutes ?? 15;
  form.participantIds = props.event?.participants.map((participant) => participant.id) ?? [props.currentUserId];
  if (!form.participantIds.includes(organizerId.value)) form.participantIds.push(organizerId.value);
  saving.value = false;
  errorMessage.value = '';
};

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) resetForm();
  },
);

const toggleParticipant = (userId: number) => {
  if (!props.editable || userId === organizerId.value) return;
  if (form.participantIds.includes(userId)) {
    form.participantIds = form.participantIds.filter((id) => id !== userId);
  } else {
    form.participantIds.push(userId);
  }
};

const showError = async (message: string) => {
  errorMessage.value = message;
  await nextTick();
  errorSummary.value?.focus();
};

const submit = async () => {
  if (!props.editable || saving.value) return;
  const title = form.title.trim();
  if (!title) return showError('Укажите название встречи.');
  const date = form.date instanceof Date ? format(form.date, 'yyyy-MM-dd') : form.date;
  const start = new Date(`${date ?? ''}T${form.startTime}:00`);
  const end = new Date(`${date ?? ''}T${form.endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return showError('Укажите дату и время встречи.');
  if (end <= start) return showError('Время окончания должно быть позже времени начала.');
  const meetingUrl = form.meetingUrl.trim();
  if (meetingUrl) {
    try {
      const url = new URL(meetingUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return showError('Ссылка должна начинаться с http:// или https://.');
    } catch {
      return showError('Укажите корректную ссылку на встречу.');
    }
  }

  errorMessage.value = '';
  saving.value = true;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  emit('save', {
    title,
    notes: form.notes.trim() || null,
    meeting_url: meetingUrl || null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    timezone,
    reminder_minutes: Number(form.reminderMinutes),
    participant_ids: [...new Set([...form.participantIds, organizerId.value])],
  });
};

const setSaving = (value: boolean) => {
  saving.value = value;
};

const setError = (message: string) => showError(message);

defineExpose({ setSaving, setError });
</script>

<template>
  <BaseModal :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" @close="emit('close')">
    <form class="event-form" @submit.prevent="submit">
      <div class="event-form__heading">
        <div>
          <p class="event-form__eyebrow">{{ isEditing ? 'Встреча' : 'Новая встреча' }}</p>
          <h2>{{ isEditing ? event?.title : 'Добавить встречу' }}</h2>
        </div>
      </div>

      <div v-if="errorMessage" ref="errorSummary" class="event-form__error" tabindex="-1" role="alert">
        {{ errorMessage }}
      </div>

      <label class="event-form__field">
        <span>Название</span>
        <input v-model="form.title" name="title" maxlength="200" :disabled="!editable || saving" required />
      </label>

      <div class="event-form__row">
        <div class="event-form__field event-form__field_date">
          <span>Дата</span>
          <BaseDatePicker
            v-model="form.date"
            class="event-form__date-picker"
            format-date="dd.MM.yyyy"
            placeholder="Выберите дату"
            :disabled="!editable || saving"
          />
        </div>
        <div class="event-form__field">
          <span>Начало</span>
          <BaseSelect
            v-model="startTimeValue"
            class="event-form__select"
            :options="timeOptions"
            placeholder="Начало"
            :disabled="!editable || saving"
            large
            arrow
          />
        </div>
        <div class="event-form__field">
          <span>Окончание</span>
          <BaseSelect
            v-model="endTimeValue"
            class="event-form__select"
            :options="timeOptions"
            placeholder="Окончание"
            :disabled="!editable || saving"
            large
            arrow
          />
        </div>
      </div>

      <label class="event-form__field">
        <span>Ссылка на встречу</span>
        <span class="event-form__url-input">
          <Link2 :size="18" :stroke-width="1.75" aria-hidden="true" />
          <input
            v-model="form.meetingUrl"
            name="meeting-url"
            type="url"
            maxlength="2000"
            placeholder="https://meet.google.com/..."
            autocomplete="url"
            :disabled="!editable || saving"
          />
        </span>
      </label>

      <fieldset class="event-form__participants" :disabled="!editable || saving">
        <legend>Участники</legend>
        <div class="event-form__participant-list">
          <label v-for="user in users" :key="user.id" class="event-form__participant">
            <input
              type="checkbox"
              :checked="form.participantIds.includes(user.id)"
              :disabled="!editable || saving || user.id === organizerId"
              @change="toggleParticipant(user.id)"
            />
            <span class="event-form__avatar" aria-hidden="true">
              <img v-if="user.photo_url" :src="user.photo_url" alt="" />
              <span v-else>{{ user.first_name[0] }}{{ user.last_name[0] }}</span>
            </span>
            <span class="event-form__participant-info">
              <strong>{{ user.first_name }} {{ user.last_name }}</strong>
              <small>{{ user.email || 'Email не указан' }}{{ user.id === organizerId ? ' · организатор' : '' }}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div class="event-form__field">
        <span>Напомнить</span>
        <BaseSelect
          v-model="reminderValue"
          class="event-form__select"
          :options="reminderOptions"
          placeholder="Выберите время"
          :disabled="!editable || saving"
          large
          arrow
        />
      </div>

      <div class="event-form__delivery">
        <Bell :size="17" :stroke-width="1.75" aria-hidden="true" />
        <Mail :size="17" :stroke-width="1.75" aria-hidden="true" />
        <span>Каждый участник получит Push и письмо в указанное время.</span>
      </div>

      <label class="event-form__field">
        <span>Заметки</span>
        <textarea v-model="form.notes" name="notes" rows="4" maxlength="10000" :disabled="!editable || saving" />
      </label>

      <div class="event-form__actions">
        <button v-if="isEditing && editable" class="event-form__delete" type="button" :disabled="saving" @click="emit('delete')">
          <Trash2 :size="17" :stroke-width="1.75" aria-hidden="true" />
          Удалить
        </button>
        <span class="event-form__actions-spacer" />
        <button class="event-form__cancel" type="button" :disabled="saving" @click="emit('update:modelValue', false)">
          {{ editable ? 'Отмена' : 'Закрыть' }}
        </button>
        <button v-if="editable" class="event-form__submit" type="submit" :disabled="saving">
          {{ saving ? 'Сохраняем...' : isEditing ? 'Сохранить' : 'Добавить встречу' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped lang="scss">
:deep(.base-modal__content) {
  width: min(668px, calc(100vw - 32px));
}

.event-form {
  width: min(620px, calc(100vw - 64px));
  padding: 0 24px;
  color: var(--light-text-backgroung-primary);
  @include flex(cn);
  gap: 18px;

  &__heading {
    @include flex(rn, a-center);
    justify-content: space-between;
    min-width: 0;

    h2 {
      margin: 2px 0 0;
      max-width: 22ch;
      overflow-wrap: anywhere;
      @extend %display-xs-medium;
    }
  }

  &__eyebrow {
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-medium;
  }

  &__error {
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, #e25b5b 55%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, #e25b5b 12%, transparent);
    color: #ffd6d6;
    outline: none;
    @extend %text-s-regular;
  }

  &__row {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr;
    gap: 12px;
  }

  &__field {
    min-width: 0;
    @include flex(cn);
    gap: 7px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-medium;

    input,
    textarea {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      font: inherit;
      font-size: 16px;

      &:focus-visible {
        border-color: var(--primary);
        outline: 2px solid color-mix(in srgb, var(--primary) 38%, transparent);
        outline-offset: 1px;
      }

      &:disabled {
        opacity: 0.7;
        cursor: default;
      }
    }

    textarea {
      min-height: 104px;
      resize: vertical;
    }
  }

  &__date-picker,
  &__select {
    width: 100%;
  }

  &__url-input {
    position: relative;
    display: block;
    color: var(--light-text-backgroung-primary-50);

    svg {
      position: absolute;
      z-index: 1;
      top: 50%;
      left: 12px;
      pointer-events: none;
      transform: translateY(-50%);
    }

    input {
      padding-left: 40px;
    }
  }

  &__date-picker {
    :deep(.dp__main) {
      width: 100%;
    }

    :deep(.dp__input_icon_pad) {
      width: 100%;
      height: 44px;
      min-height: 44px;
      padding: 10px 42px 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      @extend %text-s-regular;
    }

    :deep(.dp__input_icon) {
      top: 50%;
      right: 12px;
      color: var(--light-text-backgroung-primary-50);
      transform: translateY(-50%);

      svg {
        fill: currentColor;
      }
    }

    :deep(.dp__input_focus) {
      border-color: var(--primary);
      outline: 2px solid var(--primary-25);
      outline-offset: 1px;
    }
  }

  &__select {
    :deep(.home-select__input_large) {
      min-height: 44px;
      padding: 10px 12px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    :deep(.home-select__input_large:focus-visible) {
      border-color: var(--primary);
      outline: 2px solid var(--primary-25);
      outline-offset: 1px;
    }

    :deep(.home-select__dropdown_large) {
      max-height: 260px;
      background: var(--dark-text-background-primary);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__participants {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;

    legend {
      margin-bottom: 7px;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-s-medium;
    }
  }

  &__participant-list {
    max-height: 188px;
    overflow-y: auto;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
  }

  &__participant {
    min-height: 54px;
    padding: 8px 12px;
    @include flex(rn, a-center);
    gap: 10px;
    cursor: pointer;

    &:not(:last-child) {
      border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    }

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    input {
      width: 18px;
      height: 18px;
      accent-color: var(--primary);
    }
  }

  &__avatar {
    width: 32px;
    height: 32px;
    overflow: hidden;
    flex: 0 0 32px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary) 28%, var(--dark-text-background-primary));
    color: var(--light-text-backgroung-primary);
    @include flex(center);
    @extend %text-xs-medium;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__participant-info {
    min-width: 0;
    @include flex(cn);

    strong,
    small {
      overflow-wrap: anywhere;
    }

    strong {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-medium;
    }

    small {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }
  }

  &__delivery {
    margin-top: -8px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__actions-spacer {
    flex: 1;
  }

  &__delete,
  &__cancel,
  &__submit {
    min-height: 44px;
    padding: 10px 14px;
    border: 0;
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-medium;

    &:focus-visible {
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.55;
      cursor: default;
    }
  }

  &__delete {
    @include flex(rn, a-center);
    gap: 7px;
    background: color-mix(in srgb, #e25b5b 12%, transparent);
    color: #ffbcbc;
  }

  &__cancel {
    background: var(--light-text-backgroung-primary-5);
  }

  &__submit {
    background: var(--primary);
  }

  @media (max-width: $screen-mobile-l) {
    width: calc(100vw - 48px);
    padding: 0 16px;
    gap: 16px;

    &__row {
      grid-template-columns: 1fr 1fr;
    }

    &__field_date {
      grid-column: 1 / -1;
    }

    &__actions {
      flex-wrap: wrap;
    }

    &__actions-spacer {
      display: none;
    }

    &__delete {
      width: 100%;
    }

    &__cancel,
    &__submit {
      flex: 1;
    }
  }
}
</style>
