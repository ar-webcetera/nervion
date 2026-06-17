<script setup lang="ts">
import type { WorkSchedule, CreateWorkScheduleDto } from '~/types/work-schedule';
import type { User } from '~/types/user';
import { ROLES } from '~/types/user';

interface Props {
  schedule?: WorkSchedule | null;
  users: User[];
  isAdmin: boolean;
  prefilledUserId?: number | null;
  prefilledDate?: string | null;
  existingSlots?: WorkSchedule[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  save: [data: CreateWorkScheduleDto];
  delete: [id: number];
}>();

const isDayOff = ref(props.schedule?.is_day_off ?? false);

const startTimeRef = ref<HTMLInputElement | null>(null);
const endTimeRef = ref<HTMLInputElement | null>(null);

const openPicker = (el: HTMLInputElement | null) => {
  if (!el) return;
  el.focus();
  try {
    el.showPicker();
  } catch {}
};

const form = ref({
  user_id: props.schedule?.user_id ?? props.prefilledUserId ?? 0,
  work_date: props.schedule?.work_date ?? props.prefilledDate ?? '',
  start_time: props.schedule?.start_time ?? '09:00',
  end_time: props.schedule?.end_time ?? '18:00',
  notes: props.schedule?.notes ?? '',
});

const isEdit = computed(() => !!props.schedule);

const computedHours = computed(() => {
  if (isDayOff.value) return 0;
  if (!form.value.start_time || !form.value.end_time) return 0;
  const [sh, sm] = form.value.start_time.split(':').map(Number);
  const [eh, em] = form.value.end_time.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, Math.round(diff / 60 * 10) / 10);
});

const timeError = ref('');

const handleSave = () => {
  timeError.value = '';
  if (!isDayOff.value && form.value.start_time && form.value.end_time) {
    const [sh, sm] = form.value.start_time.split(':').map(Number);
    const [eh, em] = form.value.end_time.split(':').map(Number);
    const diffMin = (eh * 60 + em) - (sh * 60 + sm);
    if (diffMin <= 0) {
      timeError.value = 'Время начала должно быть меньше времени окончания';
      return;
    }
    if (diffMin < 30) {
      timeError.value = 'Минимальная продолжительность — 30 минут';
      return;
    }
    const newStart = sh * 60 + sm;
    const newEnd = eh * 60 + em;
    const overlap = (props.existingSlots ?? []).find((s) => {
      if (s.is_day_off || !s.start_time || !s.end_time) return false;
      if (props.schedule && s.id === props.schedule.id) return false;
      const [es, ems] = s.start_time.split(':').map(Number);
      const [ee, eme] = s.end_time.split(':').map(Number);
      const existStart = es * 60 + ems;
      const existEnd = ee * 60 + eme;
      return newStart < existEnd && newEnd > existStart;
    });
    if (overlap) {
      const fmt = (t: string) => t.slice(0, 5);
      timeError.value = `Пересекается со слотом ${fmt(overlap.start_time!)}–${fmt(overlap.end_time!)}`;
      return;
    }
  }
  const data: CreateWorkScheduleDto = {
    user_id: form.value.user_id,
    work_date: form.value.work_date,
    is_day_off: isDayOff.value,
    hours: computedHours.value,
  };
  if (!isDayOff.value) {
    if (form.value.start_time) data.start_time = form.value.start_time;
    if (form.value.end_time) data.end_time = form.value.end_time;
  }
  if (form.value.notes) data.notes = form.value.notes;
  emit('save', data);
};

const handleDelete = () => {
  if (props.schedule) emit('delete', props.schedule.id);
};
</script>

<template>
  <Teleport to="body">
    <Transition appear name="modal">
      <div class="ws-modal">
        <div class="ws-modal__overlay" @click="emit('close')"></div>
      <div class="ws-modal__content">

        <div class="ws-modal__header">
          <h2 class="ws-modal__title">
            {{ isEdit ? 'Редактировать слот' : 'Добавить слот' }}
          </h2>
          <button class="ws-modal__close" @click="emit('close')">
            <IconsIconClose />
          </button>
        </div>

        <div class="ws-modal__body">

          <div v-if="isAdmin" class="ws-modal__field">
            <label class="ws-modal__label">Сотрудник</label>
            <select v-model="form.user_id" class="ws-modal__select">
              <option :value="0" disabled>Выберите сотрудника</option>
              <option v-for="user in users" :key="user.id" :value="user.id">
                {{ user.first_name }} {{ user.last_name }}
              </option>
            </select>
          </div>

          <div class="ws-modal__field">
            <label class="ws-modal__label">Дата</label>
            <input v-model="form.work_date" type="date" class="ws-modal__input" />
          </div>

          <div class="ws-modal__toggle-row">
            <span class="ws-modal__toggle-label">Выходной день</span>
            <button
              :class="['ws-modal__toggle', { 'ws-modal__toggle_on': isDayOff }]"
              @click="isDayOff = !isDayOff"
            ></button>
          </div>

          <template v-if="!isDayOff">
            <div class="ws-modal__row">
              <div class="ws-modal__field">
                <label class="ws-modal__label">Начало</label>
                <div class="ws-modal__input-wrap">
                  <input ref="startTimeRef" v-model="form.start_time" type="time" class="ws-modal__input" />
                  <button class="ws-modal__picker-btn" tabindex="-1" @click="openPicker(startTimeRef)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.5c0 .207.082.394.216.53l2.25 2.25a.75.75 0 1 0 1.06-1.06l-2.026-2.026V6.75Z" clip-rule="evenodd"/></svg>
                  </button>
                </div>
              </div>
              <div class="ws-modal__field">
                <label class="ws-modal__label">Конец</label>
                <div class="ws-modal__input-wrap">
                  <input ref="endTimeRef" v-model="form.end_time" type="time" class="ws-modal__input" />
                  <button class="ws-modal__picker-btn" tabindex="-1" @click="openPicker(endTimeRef)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.5c0 .207.082.394.216.53l2.25 2.25a.75.75 0 1 0 1.06-1.06l-2.026-2.026V6.75Z" clip-rule="evenodd"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="timeError" class="ws-modal__time-error">{{ timeError }}</div>

            <div class="ws-modal__hours-info">
              <span class="ws-modal__hours-label">Итого часов:</span>
              <span class="ws-modal__hours-value">{{ computedHours }} ч</span>
            </div>
          </template>

          <div class="ws-modal__field">
            <label class="ws-modal__label">Заметка (опционально)</label>
            <input v-model="form.notes" type="text" class="ws-modal__input" placeholder="Например: дежурство" />
          </div>

        </div>

        <div class="ws-modal__footer">
          <button v-if="isEdit" class="ws-modal__button ws-modal__button_delete" @click="handleDelete">
            Удалить
          </button>
          <div class="ws-modal__footer-right">
            <button class="ws-modal__button ws-modal__button_secondary" @click="emit('close')">
              Отмена
            </button>
            <button class="ws-modal__button ws-modal__button_primary" @click="handleSave">
              {{ isEdit ? 'Сохранить' : 'Добавить' }}
            </button>
          </div>
        </div>

      </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.ws-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  @include flex(center);

  &__overlay {
    position: absolute;
    inset: 0;
    background: var(--black-50);
    backdrop-filter: blur(4px);
  }

  &__content {
    position: relative;
    background: var(--dark-text-background-primary);
    border-radius: 12px;
    width: 90%;
    max-width: 480px;
    max-height: 90vh;
    overflow: auto;
    box-shadow: 0 20px 60px var(--black-40);
    z-index: 1001;
  }

  &__header {
    @include flex(rn, a-center, between);
    padding: 20px 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__title {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
    margin: 0;
  }

  &__close {
    width: 32px;
    height: 32px;
    @include flex(center);
    border-radius: 6px;
    background: transparent;
    transition: background 0.2s;

    &:hover { background: var(--light-text-backgroung-primary-10); }
    svg { width: 20px; height: 20px; }
  }

  &__body {
    padding: 24px;
    @include flex(cn);
    gap: 16px;
  }

  &__field {
    @include flex(cn);
    gap: 8px;
  }

  &__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  &__label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__input-wrap {
    position: relative;
    @include flex(rn, a-center);

    .ws-modal__input {
      flex: 1;
      padding-right: 36px;
    }
  }

  &__picker-btn {
    position: absolute;
    right: 8px;
    @include flex(center);
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s;

    &:hover {
      color: var(--light-text-backgroung-primary);
    }

    svg {
      width: 16px;
      height: 16px;
    }
  }

  &__input,
  &__select {
    padding: 10px 12px;
    background: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
    transition: border-color 0.2s;
    color-scheme: dark;

    &:focus {
      outline: none;
      border-color: var(--primary);
    }

    // у time-полей есть кастомная кнопка-часы — нативный индикатор прячем (иначе часы дублируются)
    &[type='time']::-webkit-calendar-picker-indicator {
      display: none;
    }

    // color-scheme: dark уже делает иконку календаря светлой; invert переворачивал её в чёрный — убрано
    &[type='date']::-webkit-calendar-picker-indicator {
      opacity: 0.7;
      cursor: pointer;

      &:hover {
        opacity: 1;
      }
    }
  }

  &__toggle-row {
    @include flex(rn, a-center, between);
    padding: 12px 14px;
    background: var(--light-text-backgroung-primary-5);
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-5);
  }

  &__toggle-label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__toggle {
    width: 40px;
    height: 22px;
    background: var(--light-text-backgroung-primary-10);
    border-radius: 11px;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    border: none;
    flex-shrink: 0;

    &::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--light-text-backgroung-primary);
      transition: left 0.2s;
    }

    &_on {
      background: var(--primary);

      &::after { left: 21px; }
    }
  }

  &__time-error {
    @extend %text-xs-regular;
    color: var(--danger-delete);
    padding: 8px 12px;
    background: var(--danger-delete-10);
    border-radius: 6px;
    border: 1px solid var(--danger-delete-25);
  }

  &__hours-info {
    @include flex(rn, a-center);
    gap: 8px;
    padding: 10px 14px;
    background: var(--primary-25);
    border-radius: 8px;
    border: 1px solid var(--primary-25);
  }

  &__hours-label {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__hours-value {
    @extend %text-m-medium;
    color: var(--primary);
  }

  &__footer {
    @include flex(rn, a-center, between);
    padding: 16px 24px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__footer-right {
    @include flex(rn);
    gap: 12px;
    margin-left: auto;
  }

  &__button {
    padding: 10px 20px;
    border-radius: 8px;
    @extend %text-s-medium;
    transition: all 0.2s;
    cursor: pointer;

    &_primary {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);
      border: none;
      &:hover { background: var(--primary-dark); }
    }

    &_secondary {
      background: transparent;
      color: var(--light-text-backgroung-primary);
      border: 1px solid var(--primary-50);
      &:hover { background: var(--light-text-backgroung-primary-5); }
    }

    &_delete {
      background: var(--danger-delete-10);
      color: var(--danger-delete);
      border: none;
      &:hover { background: var(--danger-delete-25); }
    }
  }
}

// Появление модалки: fade оверлея + лёгкий подъём со scale у панели
.modal-enter-active {
  transition: opacity 0.22s ease;

  .ws-modal__content {
    transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease;
  }
}
.modal-enter-from {
  opacity: 0;

  .ws-modal__content {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
}
</style>
