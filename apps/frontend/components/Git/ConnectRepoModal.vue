<script setup lang="ts">
import { ref } from 'vue';
import { useGitStore } from '~/stores/gitStore';
import { getErrorMessage } from '~/utils/error';
import type { GitRepo } from '~/types/git';
import { useTenantStore } from '~/stores/tenantStore';

const emit = defineEmits<{ (e: 'created', repo: GitRepo): void }>();

const gitStore = useGitStore();
const tenantStore = useTenantStore();
const { $toast } = useNuxtApp();

const modal = ref();
const name = ref('');
const gitdir = ref('');
const remoteUrl = ref('');
const username = ref('');
const token = ref('');
const showToken = ref(false);
const errorMessage = ref('');
const defaultBranch = ref('');
const pending = ref(false);

const open = () => {
  name.value = '';
  gitdir.value = '';
  remoteUrl.value = '';
  username.value = '';
  token.value = '';
  showToken.value = false;
  errorMessage.value = '';
  defaultBranch.value = '';
  modal.value?.open();
};

const close = () => modal.value?.close();

const submit = async () => {
  if (pending.value || tenantStore.readOnly) return;
  errorMessage.value = '';
  if (!name.value.trim() || !(tenantStore.enabled ? remoteUrl.value.trim() : gitdir.value.trim())) {
    errorMessage.value = tenantStore.enabled ? 'Заполните название и HTTPS-адрес репозитория' : 'Заполните название и путь';
    return;
  }
  if (token.value && !username.value.trim()) {
    errorMessage.value = 'Для токена укажите имя пользователя Git-провайдера';
    return;
  }
  pending.value = true;
  try {
    const repo = await gitStore.createRepo({
      name: name.value.trim(),
      ...(tenantStore.enabled
        ? { remoteUrl: remoteUrl.value.trim(), username: username.value.trim(), token: token.value }
        : { gitdir: gitdir.value.trim() }),
      defaultBranch: defaultBranch.value.trim() || undefined,
    });
    $toast.success('Репозиторий подключён');
    emit('created', repo);
    close();
  } catch (e) {
    errorMessage.value = getErrorMessage(e);
  } finally {
    pending.value = false;
  }
};

defineExpose({ open });
</script>

<template>
  <BaseModal
    ref="modal"
    :dismissible="!pending"
    @close="
      token = '';
      showToken = false;
    "
  >
    <form
      class="connect"
      :aria-busy="pending"
      :aria-describedby="errorMessage ? 'git-connect-error' : undefined"
      @submit.prevent="submit"
    >
      <h2 class="connect__title">Подключить репозиторий</h2>

      <label class="connect__field">
        <span class="connect__label">Название</span>
        <input
          v-model="name"
          name="repository-name"
          class="connect__input"
          placeholder="my-repo"
          maxlength="100"
          required
          :disabled="pending"
        />
      </label>

      <label v-if="!tenantStore.enabled" class="connect__field">
        <span class="connect__label">Путь к git-каталогу</span>
        <input
          v-model="gitdir"
          name="gitdir"
          class="connect__input"
          placeholder="/var/git/my-repo.git"
          required
          :disabled="pending"
        />
      </label>

      <template v-else>
        <label class="connect__field">
          <span class="connect__label">HTTPS-адрес репозитория</span>
          <input
            v-model="remoteUrl"
            name="repository-url"
            type="url"
            class="connect__input"
            placeholder="https://github.com/team/repo.git"
            maxlength="2048"
            required
            :disabled="pending"
            aria-describedby="git-source-help"
          />
        </label>
        <p id="git-source-help" class="connect__help">
          Домен должен быть разрешен оператором Нервиона. Для закрытого репозитория нужен токен с доступом только на чтение.
        </p>
        <label class="connect__field">
          <span class="connect__label">Имя пользователя Git-провайдера</span>
          <input
            v-model="username"
            name="git-username"
            autocomplete="username"
            class="connect__input"
            maxlength="200"
            :disabled="pending"
            :required="Boolean(token)"
          />
        </label>
        <label class="connect__field">
          <span class="connect__label">Токен доступа, если репозиторий закрытый</span>
          <input
            v-model="token"
            name="git-token"
            :type="showToken ? 'text' : 'password'"
            autocomplete="new-password"
            class="connect__input"
            maxlength="4096"
            :disabled="pending"
          />
        </label>
        <button type="button" class="connect__token-toggle" :aria-pressed="showToken" @click="showToken = !showToken">
          {{ showToken ? 'Скрыть токен' : 'Показать токен' }}
        </button>
      </template>

      <label class="connect__field">
        <span class="connect__label"> Ветка по умолчанию <span class="connect__hint">(необязательно)</span> </span>
        <input
          v-model="defaultBranch"
          name="default-branch"
          class="connect__input"
          placeholder="определится автоматически"
          :disabled="pending"
        />
      </label>

      <p v-if="errorMessage" id="git-connect-error" class="connect__error" role="alert">{{ errorMessage }}</p>

      <div class="connect__actions">
        <button type="button" class="connect__btn connect__btn_ghost" :disabled="pending" @click="close">Отмена</button>
        <button type="submit" class="connect__btn connect__btn_primary" :disabled="pending || tenantStore.readOnly">
          {{ pending ? 'Подключаю…' : 'Подключить' }}
        </button>
      </div>
    </form>
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
    color: var(--light-text-backgroung-primary-50);
  }

  &__help,
  &__error {
    margin: 0;
    overflow-wrap: anywhere;
    @extend %text-s-regular;
  }

  &__help {
    color: var(--light-text-backgroung-primary-50);
  }
  &__error {
    color: var(--danger-delete);
  }

  &__token-toggle {
    align-self: flex-start;
    border: 0;
    padding: 8px 0;
    min-height: 44px;
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    text-decoration: underline;
    @extend %text-s-regular;
  }

  &__input {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    outline: none;
    @extend %text-m-regular;

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
    min-height: 44px;
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

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  @media (max-width: $screen-mobile-l) {
    padding: 0 16px;
    &__actions {
      flex-wrap: wrap;
    }
  }
}
</style>
