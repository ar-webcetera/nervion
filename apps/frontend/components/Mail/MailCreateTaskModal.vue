<script setup lang="ts">
import { X } from '@lucide/vue';

const props = defineProps<{
  modelValue: boolean;
  scope: 'thread' | 'message';
  subject: string;
  pending: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [instruction: string];
}>();

const instruction = ref('');
const instructionInput = ref<HTMLTextAreaElement | null>(null);

const close = () => {
  if (props.pending) return;
  emit('update:modelValue', false);
};

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      instruction.value = '';
      return;
    }
    await nextTick();
    instructionInput.value?.focus();
  },
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :dismissible="!pending"
    :show-close="false"
    @update:model-value="emit('update:modelValue', $event)"
    @close="close"
  >
    <form class="mail-task" :aria-busy="pending" @submit.prevent="emit('submit', instruction.trim())">
      <header class="mail-task__header">
        <div class="mail-task__heading">
          <h2 class="mail-task__title">Создать задачу из {{ scope === 'thread' ? 'переписки' : 'письма' }}</h2>
          <p class="mail-task__description">
            ИИ подготовит название и описание. Перед созданием задачу можно будет проверить и дополнить.
          </p>
        </div>
        <button
          class="mail-task__close"
          type="button"
          :disabled="pending"
          aria-label="Закрыть"
          title="Закрыть"
          @click="close"
        >
          <X :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </header>

      <div class="mail-task__source">
        <span>{{ scope === 'thread' ? 'Переписка' : 'Письмо' }}</span>
        <strong>{{ subject || 'Без темы' }}</strong>
      </div>

      <label class="mail-task__field">
        <span>Дополнительные инструкции</span>
        <textarea
          ref="instructionInput"
          v-model="instruction"
          rows="5"
          :disabled="pending"
          placeholder="Например: выдели запрос клиента и добавь критерии проверки"
        ></textarea>
      </label>
      <p class="mail-task__hint">Поле можно оставить пустым.</p>
      <p v-if="error" class="mail-task__error" role="alert">{{ error }}</p>

      <div class="mail-task__actions">
        <button class="mail-task__cancel" type="button" :disabled="pending" @click="close">Отмена</button>
        <button class="mail-task__submit" type="submit" :disabled="pending">
          <IconsIconButtonLoader v-if="pending" class="mail-task__loader" aria-hidden="true" />
          {{ pending ? 'Формирую...' : 'Сформировать задачу' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped lang="scss">
:deep(.base-modal__content) {
  width: min(620px, calc(100vw - 32px));
}

.mail-task {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 24px;
  color: var(--light-text-backgroung-primary);
  @include flex(cn);
  gap: 16px;

  &__header {
    gap: 16px;
    @include flex(rn, between, a-start);
  }

  &__heading {
    min-width: 0;
    @include flex(cn);
    gap: 6px;
  }

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__description,
  &__hint,
  &__error {
    margin: 0;
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }

  &__description,
  &__hint {
    color: var(--light-text-backgroung-primary-50);
  }

  &__close {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    @include flex(center);

    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
  }

  &__source {
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    @include flex(cn);
    gap: 4px;

    span {
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      @extend %text-m-medium;
    }
  }

  &__field {
    min-width: 0;
    @include flex(cn);
    gap: 6px;
    @extend %text-s-medium;

    textarea {
      min-height: 128px;
      resize: vertical;
      @extend %ds-field;
      @extend %text-m-regular;
    }
  }

  &__hint {
    margin-top: -10px;
    @extend %text-xs-regular;
  }

  &__error {
    padding-left: 12px;
    border-left: 2px solid var(--danger-delete);
  }

  &__actions {
    gap: 8px;
    @include flex(rn, j-end, a-center);
  }

  &__cancel {
    @extend %ds-btn-secondary;
  }

  &__submit {
    @extend %ds-btn-primary;
  }

  &__loader {
    width: 16px;
    height: 16px;
  }

  @media (max-width: $screen-mobile-l) {
    padding: 0 16px;

    &__close {
      width: 44px;
      height: 44px;
    }

    &__actions {
      align-items: stretch;
      flex-direction: column;
    }

    &__cancel,
    &__submit {
      width: 100%;
      min-height: 44px;
    }
  }
}
</style>
