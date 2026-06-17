<script setup lang="ts">
const props = defineProps<{
  userId: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const config = useRuntimeConfig();
const { $toast } = useNuxtApp();

const isLoading = ref(false);
const newPassword = ref<string | null>(null);
const isCopied = ref(false);

const resetPassword = async () => {
  try {
    isLoading.value = true;

    const response = await $fetch<{ newPassword: string }>('/api/auth/password', {
      method: 'PATCH',
      baseURL: config.public.API_URL,
      credentials: 'include',
      body: {
        userId: props.userId,
      },
    });

    newPassword.value = response.newPassword;
    $toast.success('Пароль успешно сброшен!');
  } catch (error) {
    console.error('Ошибка сброса пароля:', error);
    $toast.error('Не удалось сбросить пароль');
  } finally {
    isLoading.value = false;
  }
};

const copyPassword = async () => {
  if (!newPassword.value) return;

  try {
    await navigator.clipboard.writeText(newPassword.value);
    isCopied.value = true;
    $toast.success('Пароль скопирован в буфер обмена');

    setTimeout(() => {
      isCopied.value = false;
    }, 2000);
  } catch {
    $toast.error('Не удалось скопировать пароль');
  }
};

const closeModal = () => {
  emit('close');
};
</script>

<template>
  <div class="reset-password-modal">
    <h2 class="reset-password-modal__title">Сброс пароля</h2>

    <div v-if="!newPassword" class="reset-password-modal__content">
      <p class="reset-password-modal__description">Будет сгенерирован новый случайный пароль для пользователя.</p>

      <footer class="reset-password-modal__footer">
        <button class="btn-cancel" :disabled="isLoading" @click="closeModal">Отмена</button>
        <button class="btn-confirm" :disabled="isLoading" @click="resetPassword">
          <IconButtonLoader v-if="isLoading" class="btn__loader" />
          <span v-else>Сбросить пароль</span>
        </button>
      </footer>
    </div>

    <div v-else class="reset-password-modal__success">
      <p class="reset-password-modal__success-text">Новый пароль успешно сгенерирован:</p>

      <div class="reset-password-modal__password-container">
        <input :value="newPassword" type="text" readonly class="reset-password-modal__password-input" />
        <button class="btn-copy" :class="{ 'btn-copy_copied': isCopied }" @click="copyPassword">
          {{ isCopied ? '✓' : 'Копировать' }}
        </button>
      </div>

      <p class="reset-password-modal__warning">⚠️ Сохраните пароль, он больше не будет показан</p>

      <footer class="reset-password-modal__footer">
        <button class="btn-confirm" @click="closeModal">Закрыть</button>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
.reset-password-modal {
  background-color: var(--dark-text-background-primary);
  border-radius: 8px;
  padding: 0 24px;
  width: 100%;
  max-width: 500px;

  &__title {
    margin: 0;
    @extend %h1;
    color: var(--light-text-backgroung-primary);
  }

  &__content {
    @include flex(cn);
    gap: 24px;
  }

  &__description {
    @extend %text-s-regular;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  &__success {
    @include flex(cn);
    gap: 16px;
  }

  &__success-text {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);
    margin-bottom: 8px;
  }

  &__password-container {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__password-input {
    flex: 1;
    background-color: var(--light-text-backgroung-primary-5);
    border: 1px solid var(--primary);
    border-radius: 8px;
    padding: 12px 16px;
    color: var(--light-text-backgroung-primary);
    @extend %text-m-regular;
    font-family: monospace;
    letter-spacing: 1px;

    &:focus {
      outline: none;
    }
  }

  &__warning {
    @extend %text-xs-regular;
    color: var(--accent);
    background-color: var(--accent-10);
    padding: 12px;
    border-radius: 8px;
    border-left: 3px solid var(--accent);
  }

  &__footer {
    @include flex(rn, j-end);
    gap: 12px;
    margin-top: 8px;
  }
}

.btn-confirm {
  padding: 10px 20px;
  border-radius: 8px;
  background-color: var(--primary);
  color: var(--light-text-backgroung-primary);
  @extend %text-s-medium;
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
  padding: 10px 20px;
  border-radius: 8px;
  background-color: transparent;
  border: 1px solid var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  @extend %text-s-medium;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover:not(:disabled) {
    background-color: var(--light-text-backgroung-primary-5);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-copy {
  padding: 10px 16px;
  border-radius: 8px;
  background-color: var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  @extend %text-s-medium;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    background-color: var(--primary);
  }

  &_copied {
    background-color: var(--green);
    color: var(--light-text-backgroung-primary);
  }
}

.btn__loader {
  width: 16px;
  height: 16px;
}
</style>
