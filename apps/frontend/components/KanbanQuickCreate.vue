<script setup lang="ts">
import { type TASK_STATUSES, MAX_TASK_NAME_LENGTH } from '~/constants/task.constants';
import { TaskType } from '~/enums/task.enums';

const props = defineProps<{ status: TASK_STATUSES }>();
const emit = defineEmits<{ close: []; created: []; pending: [value: boolean] }>();
const taskStore = useTaskStore();
const projectStore = useProjectStore();
const title = ref('');
const projectId = ref<number | null>(null);
const pending = ref(false);
watch(pending, (value) => emit('pending', value), { flush: 'sync' });
const error = ref('');
const titleInput = ref<HTMLInputElement | null>(null);
const projectOptions = computed(() => projectStore.projects.map((project) => ({ label: project.name, value: project.id })));
const selectedProjects = taskStore.filter.projects;
if (Array.isArray(selectedProjects) && selectedProjects.length === 1 && !taskStore.filter.negativeFilters?.projects) {
  projectId.value = selectedProjects[0];
} else if (projectOptions.value.length === 1) {
  projectId.value = projectOptions.value[0].value;
}

onMounted(() => titleInput.value?.focus());
const close = () => {
  if (!pending.value) emit('close');
};
const submit = async () => {
  if (pending.value) return;
  error.value = '';
  if (!title.value.trim()) {
    error.value = 'Введите название задачи.';
    titleInput.value?.focus();
    return;
  }
  if (!projectId.value) {
    error.value = 'Выберите проект для задачи.';
    return;
  }
  pending.value = true;
  try {
    await taskStore.createTask({
      title: title.value.trim(),
      project_id: projectId.value,
      status: props.status,
      taskType: TaskType.TASK,
    });
  } catch {
    error.value = 'Не удалось создать задачу. Попробуйте ещё раз.';
    return;
  } finally {
    pending.value = false;
  }
  emit('created');
};
</script>

<template>
  <form class="quick-create" :aria-busy="pending" @submit.prevent="submit" @keydown.esc.stop.prevent="close">
    <label class="quick-create__label">
      Название задачи
      <input
        ref="titleInput"
        v-model="title"
        class="quick-create__field"
        :maxlength="MAX_TASK_NAME_LENGTH"
        :disabled="pending"
        :aria-describedby="error ? `quick-create-error-${status}` : undefined"
        autocomplete="off"
      />
    </label>
    <div class="quick-create__label">
      <span :id="`quick-create-project-${status}`">Проект</span>
      <BaseSelect
        class="quick-create__project"
        :model-value="projectId"
        :options="projectOptions"
        placeholder="Выберите проект"
        large
        arrow
        :disabled="pending"
        :aria-labelledby="`quick-create-project-${status}`"
        @update:model-value="projectId = typeof $event === 'number' ? $event : null"
      />
    </div>
    <p v-if="error" :id="`quick-create-error-${status}`" class="quick-create__error" role="alert">{{ error }}</p>
    <div class="quick-create__actions">
      <button class="quick-create__submit" type="submit" :disabled="pending">
        <IconsIconButtonLoader v-if="pending" class="quick-create__loader" aria-hidden="true" />
        {{ pending ? 'Создание…' : 'Создать' }}
      </button>
      <button class="quick-create__cancel" type="button" :disabled="pending" @click="close">Отмена</button>
    </div>
  </form>
</template>

<style scoped lang="scss">
.quick-create {
  @extend %ds-card;
  @include flex(cn);
  flex-shrink: 0;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 8px;
  color: var(--light-text-backgroung-primary);

  &__label {
    @include flex(cn);
    gap: 4px;
    min-width: 0;
    @extend %text-s-regular;
  }

  &__field {
    @extend %ds-field;
    min-width: 0;
    min-height: 36px;
    padding: 6px 12px;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__project {
    :deep(.home-select__input_large) {
      min-height: 36px;
      padding: 6px 12px;
    }
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__submit {
    @extend %ds-btn-primary;
    min-height: 36px;
    padding: 6px 12px;
  }

  &__cancel {
    @extend %ds-btn-secondary;
    min-height: 36px;
    padding: 6px 12px;

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__submit:focus-visible,
  &__cancel:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  &__loader {
    width: 16px;
    height: 16px;
  }

  &__error {
    margin: 0;
    padding-left: 12px;
    border-left: 2px solid var(--danger-delete);
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }
  @media (pointer: coarse) {
    &__field,
    &__submit,
    &__cancel,
    &__project :deep(.home-select__input_large) {
      min-height: 44px;
      padding: 10px 12px;
    }
  }
}
</style>
