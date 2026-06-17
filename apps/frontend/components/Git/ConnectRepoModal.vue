<script setup lang="ts">
import { ref } from 'vue';
import { useGitStore } from '~/stores/gitStore';
import { getErrorMessage } from '~/utils/error';
import type { GitRepo } from '~/types/git';

const emit = defineEmits<{ (e: 'created', repo: GitRepo): void }>();

const gitStore = useGitStore();
const { $toast } = useNuxtApp();

const modal = ref();
const name = ref('');
const gitdir = ref('');
const defaultBranch = ref('');
const pending = ref(false);

const open = () => {
  name.value = '';
  gitdir.value = '';
  defaultBranch.value = '';
  modal.value?.open();
};

const close = () => modal.value?.close();

const submit = async () => {
  if (!name.value.trim() || !gitdir.value.trim()) {
    $toast.error('Заполните название и путь');
    return;
  }
  pending.value = true;
  try {
    const repo = await gitStore.createRepo({
      name: name.value.trim(),
      gitdir: gitdir.value.trim(),
      defaultBranch: defaultBranch.value.trim() || undefined,
    });
    $toast.success('Репозиторий подключён');
    emit('created', repo);
    close();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    pending.value = false;
  }
};

defineExpose({ open });
</script>

<template>
  <BaseModal ref="modal">
    <div class="connect">
      <h2 class="connect__title">Подключить репозиторий</h2>

      <label class="connect__field">
        <span class="connect__label">Название</span>
        <input v-model="name" class="connect__input" placeholder="my-repo" />
      </label>

      <label class="connect__field">
        <span class="connect__label">Путь к git-каталогу</span>
        <input v-model="gitdir" class="connect__input" placeholder="/var/git/my-repo.git" />
      </label>

      <label class="connect__field">
        <span class="connect__label">
          Ветка по умолчанию <span class="connect__hint">— можно оставить пустым</span>
        </span>
        <input v-model="defaultBranch" class="connect__input" placeholder="определится автоматически" />
      </label>

      <div class="connect__actions">
        <button class="connect__btn connect__btn_ghost" @click="close">Отмена</button>
        <button class="connect__btn connect__btn_primary" :disabled="pending" @click="submit">
          {{ pending ? 'Подключаю…' : 'Подключить' }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.connect {
  @include flex(cn);
  gap: 16px;
  width: 100%;
  padding: 0 24px;
  box-sizing: border-box;

  &__title {
    margin: 0;
    @extend %h1;
  }

  &__field {
    @include flex(cn);
    gap: 6px;
  }

  &__label {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary-50);
  }

  &__hint {
    color: var(--light-text-backgroung-primary-25);
  }

  &__input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %text-s-regular;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }
    &:focus {
      border-color: var(--primary-50);
    }
  }

  &__actions {
    @include flex(rn, j-end, a-center);
    gap: 10px;
    margin-top: 4px;
  }

  &__btn {
    padding: 10px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    @extend %text-s-medium;

    &_ghost {
      background: transparent;
      border: 1px solid var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }
    &_primary {
      background: var(--primary);
      color: var(--light-text-backgroung-primary);

      &:hover:not(:disabled) {
        background: var(--primary-hover);
      }
      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }
}
</style>
