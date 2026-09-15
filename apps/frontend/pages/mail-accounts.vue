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
  user_id: null as number | null,
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

const ownerName = (account: MailAccount) => (account.user_id ? userName(account.user_id) : 'Не выбран');

watch(
  () => form.user_id,
  (ownerId) => {
    if (ownerId && !form.allowedUserIds.includes(ownerId)) {
      form.allowedUserIds = [...form.allowedUserIds, ownerId];
    }
  },
);

watch(
  () => form.allowedUserIds,
  (allowedUserIds) => {
    if (form.user_id && !allowedUserIds.includes(form.user_id)) {
      form.user_id = null;
    }
  },
  { deep: true },
);

await useAsyncData('mail-accounts-init', async () => {
  await Promise.all([mailStore.fetchManageAccounts(), userStore.fetchUsers()]);
  return true;
});

const resetForm = () => {
  form.address = '';
  form.display_name = '';
  form.allowedUserIds = [];
  form.user_id = null;
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
  form.user_id = account.user_id;
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
    user_id: form.user_id,
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
        <p class="mail-accounts__subtitle">Настраивайте доступ к письмам и получателей уведомлений.</p>
      </div>
      <button class="mail-accounts__add" @click="openCreate">Добавить ящик</button>
    </header>
    <hr />

    <div class="mail-accounts__list">
      <div class="mail-accounts__row mail-accounts__row_head">
        <span>Адрес</span>
        <span>Доступ</span>
        <span>Владелец</span>
        <span>Статус</span>
        <span></span>
      </div>

      <div v-if="!manageAccounts.length" class="mail-accounts__empty">Ящиков пока нет</div>

      <div v-for="account in manageAccounts" :key="account.id" class="mail-accounts__row">
        <span class="mail-accounts__address">
          <span class="mail-accounts__mobile-label">Адрес</span>
          {{ account.address }}
        </span>
        <span class="mail-accounts__user">
          <span class="mail-accounts__mobile-label">Доступ</span>
          {{ accessNames(account) || 'Нет доступа' }}
        </span>
        <span class="mail-accounts__user">
          <span class="mail-accounts__mobile-label">Владелец</span>
          {{ ownerName(account) }}
        </span>
        <span class="mail-accounts__status-cell">
          <span class="mail-accounts__mobile-label">Статус</span>
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

        <label class="mail-accounts__field">
          Владелец ящика
          <select v-model="form.user_id">
            <option :value="null">Не выбран</option>
            <option v-for="option in userOptions" :key="String(option.value)" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <span class="mail-accounts__hint">
            Владелец получает уведомления о новых письмах и автоматически имеет доступ к ящику.
          </span>
        </label>

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
    grid-template-columns: minmax(160px, 2fr) minmax(200px, 3fr) minmax(140px, 2fr) minmax(90px, 1fr) auto;
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

    @media (max-width: $screen-tablet) {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;

      &_head {
        display: none;
      }
    }
  }

  &__address {
    color: var(--light-text-backgroung-primary);
    overflow-wrap: anywhere;

    @media (max-width: $screen-tablet) {
      grid-column: 1;
      grid-row: 1;
      @include flex(cn);
      gap: 2px;
    }
  }

  &__user {
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;

    @media (max-width: $screen-tablet) {
      grid-column: 1 / -1;
      @include flex(cn);
      gap: 2px;
    }
  }

  &__mobile-label {
    display: none;
    color: var(--light-text-backgroung-primary-50);
    @extend %p12-medium;

    @media (max-width: $screen-tablet) {
      display: block;
    }
  }

  &__status-cell {
    @media (max-width: $screen-tablet) {
      grid-column: 1 / -1;
      @include flex(cn, a-start);
      gap: 4px;
    }
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

    @media (max-width: $screen-tablet) {
      grid-column: 2;
      grid-row: 1;
    }
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

    input[type='text'],
    select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      outline: none;
      @extend %text-s-regular;

      &:focus-visible {
        border-color: var(--primary-50);
        outline: 2px solid var(--primary-50);
        outline-offset: 2px;
      }

      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }

    }

    select {
      cursor: pointer;
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
