<script setup lang="ts">
import { storeToRefs } from 'pinia';
import BaseModal from '~/components/BaseModal.vue';
import BaseSelect from '~/components/BaseSelect.vue';
import { ROLES } from '~/types/user';
import type { MailAccount, MailAccountPayload } from '~/types/mail';
import type { SelectOption } from '~/types/select';
import { getErrorMessage } from '~/utils/error';
import { useMailStore } from '~/stores/mailStore';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

const { $toast } = useNuxtApp();
const mailStore = useMailStore();
const userStore = useUserStore();
const { manageAccounts } = storeToRefs(mailStore);

const modal = ref<InstanceType<typeof BaseModal> | null>(null);
const saving = ref(false);
const editingId = ref<number | null>(null);

const form = reactive({
  address: '',
  display_name: '' as string | null,
  allowedUserIds: [] as number[],
  is_active: true,
});

const userOptions = computed<SelectOption[]>(() =>
  userStore.users
    .filter((user) => user.role !== ROLES.guest)
    .map((user) => ({
      label: `${user.last_name} ${user.first_name}`.trim() || user.email,
      value: user.id,
    })),
);

const userName = (userId: number) => {
  const user = userStore.users.find((item) => item.id === userId);
  return user ? `${user.last_name} ${user.first_name}`.trim() || user.email : `#${userId}`;
};

const accessNames = (account: MailAccount) => {
  const ids = (account.allowedUsers ?? []).map((user) => user.id);
  if (!ids.length) return '';
  return ids.map(userName).join(', ');
};

// грузим в SSR (useAsyncData), чтобы список ящиков был в первом рендере, а не после маунта
await useAsyncData('mail-accounts-init', async () => {
  await Promise.all([mailStore.fetchManageAccounts(), userStore.fetchUsers()]);
  return true;
});

const resetForm = () => {
  form.address = '';
  form.display_name = '';
  form.allowedUserIds = [];
  form.is_active = true;
};

const openCreate = () => {
  editingId.value = null;
  resetForm();
  modal.value?.open();
};

const openEdit = (account: MailAccount) => {
  editingId.value = account.id;
  form.address = account.address;
  form.display_name = account.display_name ?? '';
  form.allowedUserIds = (account.allowedUsers ?? []).map((user) => user.id);
  form.is_active = account.is_active;
  modal.value?.open();
};

const save = async () => {
  if (!form.address.trim()) {
    $toast.error('Укажите адрес ящика');
    return;
  }

  const payload: MailAccountPayload = {
    address: form.address.trim().toLowerCase(),
    display_name: form.display_name?.trim() || null,
    allowedUserIds: form.allowedUserIds,
    is_active: form.is_active,
  };

  saving.value = true;
  try {
    if (editingId.value) {
      await mailStore.updateAccount(editingId.value, payload);
    } else {
      await mailStore.createAccount(payload);
    }
    await mailStore.fetchManageAccounts();
    modal.value?.close();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    saving.value = false;
  }
};

const toggleActive = async (account: MailAccount) => {
  try {
    await mailStore.updateAccount(account.id, { is_active: !account.is_active });
    await mailStore.fetchManageAccounts();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};
</script>

<template>
  <div class="mail-accounts">
    <header class="mail-accounts__header">
      <div>
        <h1>Почтовые ящики</h1>
        <p class="mail-accounts__subtitle">Создавайте ящики и открывайте доступ конкретным сотрудникам.</p>
      </div>
      <button class="mail-accounts__add" @click="openCreate">Добавить ящик</button>
    </header>
    <hr />

    <div class="mail-accounts__list">
      <div class="mail-accounts__row mail-accounts__row_head">
        <span>Адрес</span>
        <span>Доступ</span>
        <span>Статус</span>
        <span></span>
      </div>

      <div v-if="!manageAccounts.length" class="mail-accounts__empty">Ящиков пока нет</div>

      <div v-for="account in manageAccounts" :key="account.id" class="mail-accounts__row">
        <span class="mail-accounts__address">{{ account.address }}</span>
        <span class="mail-accounts__user">{{ accessNames(account) || 'Нет доступа' }}</span>
        <span>
          <button
            :class="['mail-accounts__status', account.is_active ? 'mail-accounts__status_on' : 'mail-accounts__status_off']"
            @click="toggleActive(account)"
          >
            {{ account.is_active ? 'Активен' : 'Выключен' }}
          </button>
        </span>
        <span class="mail-accounts__actions">
          <button class="mail-accounts__edit" @click="openEdit(account)">Изменить</button>
        </span>
      </div>
    </div>

    <BaseModal ref="modal">
      <div class="mail-accounts__form">
        <h2 class="mail-accounts__form-title">{{ editingId ? 'Редактирование ящика' : 'Новый ящик' }}</h2>

        <label class="mail-accounts__field">
          Адрес
          <input v-model="form.address" type="text" placeholder="info@example.com" />
        </label>

        <label class="mail-accounts__field">
          Отображаемое имя
          <input v-model="form.display_name" type="text" placeholder="Webcetera" />
        </label>

        <div class="mail-accounts__field">
          Доступ к ящику
          <BaseSelect
            v-model="form.allowedUserIds"
            :options="userOptions"
            placeholder="Выберите сотрудников"
            multiselect
            large
            arrow
          />
          <span class="mail-accounts__hint">Письма этого ящика увидят только выбранные сотрудники.</span>
        </div>

        <label class="mail-accounts__checkbox">
          <input v-model="form.is_active" type="checkbox" />
          Активен
        </label>

        <div class="mail-accounts__form-actions">
          <button class="mail-accounts__add" :disabled="saving" @click="save">
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
.mail-accounts {
  width: 100%;
  height: 100dvh;
  min-width: 0;
  flex: 1;
  padding: 16px;
  @include flex(cn);
  gap: 16px;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__header {
    @include flex(rn, between, a-start);
    gap: 16px;

    @media (max-width: $screen-tablet) {
      flex-direction: column;
    }
  }

  &__subtitle {
    margin: 6px 0 0;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__add {
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-medium;

    &:hover:not(:disabled) {
      background: var(--primary-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__list {
    @include flex(cn);
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--light-text-backgroung-primary-5);
    border-radius: 12px;
    overflow: hidden;
  }

  &__row {
    display: grid;
    grid-template-columns: 2fr 3fr 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-5);
    @extend %text-s-regular;

    &:last-child {
      border-bottom: none;
    }

    &_head {
      color: var(--light-text-backgroung-primary-50);
      @extend %p12-medium;
    }
  }

  &__address {
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;
  }

  &__user {
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;
  }

  &__status {
    padding: 4px 10px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    @extend %p12-medium;

    &_on {
      background: var(--green-10);
      color: var(--green);
    }

    &_off {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__actions {
    @include flex(rn, j-end);
  }

  &__edit {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %p12-medium;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__empty {
    padding: 24px 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__form {
    @include flex(cn);
    gap: 16px;
    width: 100%;
    padding: 0 24px;

    @media (max-width: $screen-tablet) {
      min-width: 0;
    }
  }

  &__form-title {
    margin: 0;
    @extend %h1;
  }

  &__field {
    @include flex(cn);
    gap: 6px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;

    input[type='text'] {
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
  }

  &__hint {
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-regular;
  }

  &__checkbox {
    @include flex(rn, a-center);
    gap: 8px;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @extend %text-s-regular;
  }

  &__form-actions {
    @include flex(rn, j-end);
  }
}
</style>
