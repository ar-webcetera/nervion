<script setup lang="ts">
import { format } from 'date-fns';
import type { Allocation, CreateAllocationDto } from '~/types/allocation';
import type { User } from '~/types/user';
import type { Project } from '~/types/project';

interface Props {
  allocation?: Allocation | null;
  users: User[];
  projects: Project[];
  prefilledUser?: User | null;
  prefilledDate?: Date | null;
}

const props = defineProps<Props>();
const emit = defineEmits(['close', 'save', 'delete']);

const form = ref({
  user_id: props.allocation?.user_id || props.prefilledUser?.id || 0,
  project_id: props.allocation?.project_id || 0,
  start_date: props.allocation?.start_date || (props.prefilledDate ? format(props.prefilledDate, 'yyyy-MM-dd') : ''),
  end_date: props.allocation?.end_date || (props.prefilledDate ? format(props.prefilledDate, 'yyyy-MM-dd') : ''),
  start_time: props.allocation?.start_time || '',
  end_time: props.allocation?.end_time || '',
  hours: props.allocation?.hours || 8,
  notes: props.allocation?.notes || '',
});

const isEdit = computed(() => !!props.allocation);

const handleSave = () => {
  const data: CreateAllocationDto = {
    user_id: form.value.user_id,
    project_id: form.value.project_id,
    start_date: form.value.start_date,
    end_date: form.value.end_date,
    hours: form.value.hours,
  };

  if (form.value.start_time) data.start_time = form.value.start_time;
  if (form.value.end_time) data.end_time = form.value.end_time;
  if (form.value.notes) data.notes = form.value.notes;

  emit('save', data);
};

const handleDelete = () => {
  if (props.allocation) {
    emit('delete', props.allocation.id);
  }
};

const handleClose = () => {
  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <Transition appear name="modal">
      <div class="allocation-modal">
        <div class="allocation-modal__overlay" @click="handleClose"></div>
      <div class="allocation-modal__content">
      <div class="allocation-modal__header">
        <h2 class="allocation-modal__title">
          {{ isEdit ? 'Редактировать загрузку' : 'Добавить загрузку' }}
        </h2>
        <button class="allocation-modal__close" @click="handleClose">
          <IconsIconClose />
        </button>
      </div>

      <div class="allocation-modal__body">
        <div class="allocation-modal__field">
          <label class="allocation-modal__label">Специалист</label>
          <select v-model="form.user_id" class="allocation-modal__select">
            <option :value="0" disabled>Выберите специалиста</option>
            <option v-for="user in users" :key="user.id" :value="user.id">
              {{ user.first_name }} {{ user.last_name }}
            </option>
          </select>
        </div>

        <div class="allocation-modal__field">
          <label class="allocation-modal__label">Проект</label>
          <select v-model="form.project_id" class="allocation-modal__select">
            <option :value="0" disabled>Выберите проект</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </div>

        <div class="allocation-modal__row">
          <div class="allocation-modal__field">
            <label class="allocation-modal__label">Дата начала</label>
            <input v-model="form.start_date" type="date" class="allocation-modal__input" />
          </div>

          <div class="allocation-modal__field">
            <label class="allocation-modal__label">Дата окончания</label>
            <input v-model="form.end_date" type="date" class="allocation-modal__input" />
          </div>
        </div>

        <div class="allocation-modal__row">
          <div class="allocation-modal__field">
            <label class="allocation-modal__label">Время начала (опционально)</label>
            <input v-model="form.start_time" type="time" class="allocation-modal__input" />
          </div>

          <div class="allocation-modal__field">
            <label class="allocation-modal__label">Время окончания (опционально)</label>
            <input v-model="form.end_time" type="time" class="allocation-modal__input" />
          </div>
        </div>

        <div class="allocation-modal__field">
          <label class="allocation-modal__label">Часов в день</label>
          <input v-model.number="form.hours" type="number" min="1" max="24" class="allocation-modal__input" />
        </div>

        <div class="allocation-modal__field">
          <label class="allocation-modal__label">Заметки (опционально)</label>
          <textarea v-model="form.notes" class="allocation-modal__textarea" rows="3"></textarea>
        </div>
      </div>

      <div class="allocation-modal__footer">
        <button v-if="isEdit" class="allocation-modal__button allocation-modal__button_delete" @click="handleDelete">
          Удалить
        </button>
        <div class="allocation-modal__footer-right">
          <button class="allocation-modal__button allocation-modal__button_secondary" @click="handleClose">
            Отмена
          </button>
          <button class="allocation-modal__button allocation-modal__button_primary" @click="handleSave">
            {{ isEdit ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </div>
    </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.allocation-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  @include flex(center);

  &__overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--black-50);
    backdrop-filter: blur(4px);
  }

  &__content {
    position: relative;
    background: var(--dark-text-background-primary);
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
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

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    svg {
      width: 20px;
      height: 20px;
    }
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

  &__input,
  &__select,
  &__textarea {
    padding: 10px 12px;
    background: var(--dark-text-background-primary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
    transition: border-color 0.2s;

    &:focus {
      outline: none;
      border-color: var(--primary);
    }
  }

  &__textarea {
    resize: vertical;
    font-family: inherit;
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

      &:hover {
        background: var(--primary-hover);
      }
    }

    &_secondary {
      background: transparent;
      color: var(--light-text-backgroung-primary);
      border: 1px solid var(--primary-50);

      &:hover {
        background: var(--light-text-backgroung-primary-5);
      }
    }

    &_delete {
      background: var(--danger-delete-10);
      color: var(--danger-delete);

      &:hover {
        background: var(--danger-delete-25);
      }
    }
  }
}

// Появление модалки: fade оверлея + лёгкий подъём со scale у панели
.modal-enter-active {
  transition: opacity 0.22s ease;

  .allocation-modal__content {
    transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease;
  }
}
.modal-enter-from {
  opacity: 0;

  .allocation-modal__content {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
}
</style>
