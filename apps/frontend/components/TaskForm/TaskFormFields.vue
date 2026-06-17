<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useUserStore } from '~/stores/userStore';
import { useProjectStore } from '~/stores/projectStore';
import { useAiStore } from '~/stores/aiStore';
import { TASK_TYPE_OPTIONS } from '~/enums/task.enums';
import { MAX_TASK_NAME_LENGTH } from '~/constants/task.constants';
import { getErrorMessage } from '~/utils/error';
import type { JSONContent } from '@tiptap/core';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';
import IconClose from '~/components/Icons/IconClose.vue';

const editorKey = ref(1);
const isGeneratingDescription = ref(false);

const { newTask, isCreating, isDisabled, createTask: createTaskFn, resetForm } = useCreateTask();
const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const openTaskSidebar = async (taskId: number) => {
  const { ['task-id']: _currentTaskId, ['task-date']: _currentTaskDate, ...query } = route.query;

  await router.push({
    query: {
      ...query,
      'task-id': String(taskId),
    },
  });
  taskStore.currentTaskId = taskId;
  taskStore.currentTaskDate = null;
};

const handleCreateTask = async () => {
  const createdTask = await createTaskFn();
  if (createdTask) {
    resetForm();
    emit('close');
    await nextTick();
    await openTaskSidebar(createdTask.id);
  }
};

const closeSidebar = () => {
  resetForm();
  emit('close');
};

const handleTranscription = (payload: { title: string; description: JSONContent }) => {
  newTask.value.title = payload.title;
  if (payload?.description) {
    newTask.value.description = payload.description;
  }
  $toast.success('Задача сформирована');
  editorKey.value++;
};

const userStore = useUserStore();
const projectStore = useProjectStore();
const aiStore = useAiStore();
const { $toast } = useNuxtApp();

const usersOptions = computed(() => {
  return userStore.users.map((user) => ({
    label: `${user.last_name} ${user.first_name}`,
    value: user.id,
  }));
});

const projectOptions = computed(() => {
  return projectStore.projects.map((project) => ({
    label: project.name,
    value: project.id,
  }));
});

const taskTypeOptions = TASK_TYPE_OPTIONS;

if (projectOptions.value.length === 1 && !newTask.value.project_id) {
  newTask.value.project_id = projectOptions.value[0].value;
}

const showInstructionInput = ref(false);
const instruction = ref('');
const instructionInputRef = ref<HTMLInputElement | null>(null);

const openInstructionInput = async () => {
  showInstructionInput.value = true;
  await nextTick();
  instructionInputRef.value?.focus();
};

const cancelInstruction = () => {
  showInstructionInput.value = false;
  instruction.value = '';
};

const generateDescription = async () => {
  if (!newTask.value.description) return;
  showInstructionInput.value = false;
  isGeneratingDescription.value = true;
  try {
    const parsedTask = await aiStore.parseTextToTask(
      JSON.stringify(newTask.value.description),
      instruction.value.trim() || undefined,
    );
    newTask.value.description = parsedTask.description;
    instruction.value = '';
    editorKey.value++;
    $toast.success('Описание успешно сгенерировано');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    isGeneratingDescription.value = false;
  }
};
</script>

<template>
  <div class="task-form-fields">
    <div class="task-form-fields__header">
      <AudioRecorder @done="handleTranscription" />
      <input
        v-model="newTask.title"
        type="text"
        :maxlength="MAX_TASK_NAME_LENGTH"
        placeholder="Название задачи"
        class="task-form-fields__title"
      />
      <button class="task-form-fields__close-button" @click="closeSidebar">
        <IconClose />
      </button>
    </div>
    <div class="task-form-fields__content">
      <div class="task-form-fields__content-left">
        <div class="task-form-fields__description">
          <div class="task-form-fields__description-actions">
            <span @click="showInstructionInput ? cancelInstruction() : openInstructionInput()">
              <IconsIconButtonLoader v-if="isGeneratingDescription" class="btn__loader" />
              <IconsIconGenerate v-else />
            </span>
          </div>
          <Transition name="instruction-slide">
            <div v-if="showInstructionInput" class="task-form-fields__instruction">
              <input
                ref="instructionInputRef"
                v-model="instruction"
                class="task-form-fields__instruction-input"
                placeholder="Инструкция для ИИ (необязательно)..."
                @keydown.enter.prevent="generateDescription"
                @keydown.esc="cancelInstruction"
              />
              <button class="task-form-fields__instruction-submit" @click="generateDescription">
                Применить
              </button>
              <button class="task-form-fields__instruction-cancel" title="Отмена" @click="cancelInstruction">✕</button>
            </div>
          </Transition>
          <EditorTiptap
            :key="editorKey"
            :model-value="newTask.description"
            :value="newTask.description"
            :is-editable="true"
            placeholder="Опишите задачу..."
            description-create
            @update:model-value="(payload) => (newTask.description = payload)"
          />
        </div>

        <div class="task-form-fields__actions">
          <button class="btn-cancel" @click="closeSidebar">Отменить</button>
          <button class="btn-create" :disabled="isDisabled" @click="handleCreateTask">
            <IconsIconButtonLoader v-if="isCreating" class="btn__loader" />
            <span v-else>Создать задачу</span>
          </button>
        </div>
      </div>

      <div class="task-form-fields__content-right">
        <div class="task-form-fields__field">
          <label> Проект </label>
          <BaseSelect
            v-model="newTask.project_id"
            :options="projectOptions"
            placeholder="Не указан"
            @reset="newTask.project_id = null"
          />
        </div>

        <div class="task-form-fields__field">
          <label>Тип</label>
          <BaseSelect v-model="newTask.taskType" :options="taskTypeOptions" placeholder="Выберите тип" />
        </div>

        <div class="task-form-fields__field">
          <label>Ответственный</label>
          <BaseSelect
            v-model="newTask.responsible_id"
            :options="usersOptions"
            placeholder="Не указан"
            @reset="newTask.responsible_id = null"
          />
        </div>

        <div class="task-form-fields__field">
          <label>Дедлайн</label>
          <BaseDatePicker v-model="newTask.planned_date" placeholder="Не указан" format-date="dd.MM.yyyy" small />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.btn-create {
  padding: 8px 10px;
  border-radius: 8px;
  background-color: var(--primary);
  color: var(--light-text-backgroung-primary);
  @extend %text-s-regular;
  @include flex(center);
  gap: 8px;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-cancel {
  padding: 8px 10px;
  border-radius: 8px;
  background-color: transparent;
  border: 1px solid var(--primary);
  color: var(--light-text-backgroung-primary);
  @extend %text-s-regular;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--light-text-backgroung-primary-5);
  }
}

.btn__loader {
  width: 16px;
  height: 16px;
}

.task-form-fields {
  @include flex(cn);
  gap: 24px;

  @media (max-width: $screen-mobile-l) {
    padding-top: 24px;
  }

  &__header {
    @include flex(rn, a-center);
    gap: 12px;
  }

  &__close-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: var(--light-text-backgroung-primary-50);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    svg {
      width: 20px;
      height: 20px;
    }

    &:hover {
      background-color: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
  }

  &__title {
    width: 100%;
    @extend %display-s-bold;
    color: var(--light-text-backgroung-primary);

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__content {
    @include flex(rn);
    gap: 16px;

    @media (max-width: $screen-mobile-l) {
      flex-direction: column;
    }
  }

  &__content-left {
    @include flex(cn);
    gap: 32px;
    flex: 1;

    @media (max-width: $screen-mobile-l) {
      order: 2;
      gap: 16px;
    }
  }

  &__actions {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__content-right {
    @include flex(cn);
    gap: 12px;
    min-width: 150px;
    width: fit-content;

    @media (max-width: $screen-mobile-l) {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      order: 1;
    }
  }

  &__field {
    label {
      display: block;
      @extend %text-s-medium;
      color: var(--light-text-backgroung-primary);
    }
  }

  &__required {
    color: var(--accent);
    margin-left: 4px;
  }

  &__description-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  &__description {
    @include flex(cn);
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    position: relative;

    :deep(.editor_create) {
      @media (max-width: $screen-mobile-l) {
        padding-right: 8px;
      }
    }
  }

  &__description-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
    position: absolute;
    right: 16px;
    top: 16px;
    z-index: 100;

    span {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;

      &:hover {
        opacity: 0.7;
      }
    }
  }

  &__instruction {
    position: absolute;
    top: 44px;
    right: 10px;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--dark-text-background-secondary);
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    padding: 6px 8px;
    box-shadow: 0 4px 16px var(--black-25);
  }

  &__instruction-input {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-secondary);
    color: var(--light-text-primary);
    @extend %text-xs-regular;
    width: 220px;
    outline: none;

    &:focus {
      border-color: var(--primary);
    }

    &::placeholder {
      color: var(--divider);
    }
  }

  &__instruction-submit {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    @extend %text-xs-medium;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.85;
    }
  }

  &__instruction-cancel {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    @extend %text-xs-regular;
    color: var(--divider);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;

    &:hover {
      color: var(--danger-delete);
    }
  }

  .instruction-slide-enter-active,
  .instruction-slide-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .instruction-slide-enter-from,
  .instruction-slide-leave-to {
    opacity: 0;
    transform: translateY(-6px);
  }

  &__input {
    width: 100%;
    background-color: var(--light-text-backgroung-primary-5);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 12px 16px;
    color: var(--light-text-backgroung-primary);
    @extend %text-m-regular;

    &:focus {
      outline: none;
      border-color: var(--primary);
    }
  }
}
</style>
