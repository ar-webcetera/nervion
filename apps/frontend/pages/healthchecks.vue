<script setup lang="ts">
import { definePageMeta } from '#imports';
import BaseModal from '~/components/BaseModal.vue';
import { ROLES } from '~/types/user';
import { useHealthcheckStore, type HealthCheck, type CreateHealthCheckDto } from '~/stores/healthcheckStore';
import { useChatStore } from '~/stores/chatStore';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

const { $toast } = useNuxtApp();
const healthcheckStore = useHealthcheckStore();
const chatStore = useChatStore();
const userStore = useUserStore();

const modal = ref<InstanceType<typeof BaseModal> | null>(null);
const editingId = ref<number | null>(null);
const saving = ref(false);

const defaultForm = (): CreateHealthCheckDto & { is_active?: boolean } => ({
  name: '',
  url: '',
  interval_seconds: 60,
  timeout_seconds: 10,
  expected_status: 200,
  chat_id: '',
  sender_user_id: 0,
});

const form = ref(defaultForm());

await useAsyncData('healthchecks-init', async () => {
  await healthcheckStore.fetchAll();
  return true;
});

const openCreate = () => {
  editingId.value = null;
  form.value = defaultForm();
  modal.value?.open();
};

const openEdit = (hc: HealthCheck) => {
  editingId.value = hc.id;
  form.value = {
    name: hc.name,
    url: hc.url,
    interval_seconds: hc.interval_seconds,
    timeout_seconds: hc.timeout_seconds,
    expected_status: hc.expected_status,
    chat_id: hc.chat_id,
    sender_user_id: hc.sender_user_id,
  };
  modal.value?.open();
};

const save = async () => {
  if (!form.value.name.trim()) {
    $toast.error('Введите название');
    return;
  }
  if (!form.value.url.trim()) {
    $toast.error('Введите URL');
    return;
  }
  if (!form.value.chat_id) {
    $toast.error('Выберите чат');
    return;
  }
  if (!form.value.sender_user_id) {
    $toast.error('Выберите пользователя-бота');
    return;
  }

  saving.value = true;
  try {
    if (editingId.value !== null) {
      await healthcheckStore.update(editingId.value, form.value);
      $toast.success('Монитор обновлён');
    } else {
      await healthcheckStore.create(form.value);
      $toast.success('Монитор создан');
    }
    modal.value?.close();
  } catch {
    $toast.error('Не удалось сохранить');
  } finally {
    saving.value = false;
  }
};

const handleToggle = async (hc: HealthCheck) => {
  try {
    await healthcheckStore.toggle(hc.id);
  } catch {
    $toast.error('Не удалось переключить');
  }
};

const handleDelete = async (hc: HealthCheck) => {
  if (!confirm(`Удалить монитор "${hc.name}"?`)) return;
  try {
    await healthcheckStore.remove(hc.id);
    $toast.trash('Удалено');
  } catch {
    $toast.error('Не удалось удалить');
  }
};

const formatDate = (d: string | null) => {
  if (!d) return 'Ещё не проверялся';
  return new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

const formatInterval = (s: number) => {
  if (s < 60) return `каждые ${s}с`;
  const m = Math.floor(s / 60);
  return `каждые ${m} мин`;
};
</script>

<template>
  <div class="hc-page">
    <header class="hc-page__header">
      <h1>Healthcheck-мониторы</h1>
      <button class="button" @click="openCreate">
        <IconsIconPlus />
        Добавить монитор
      </button>
    </header>
    <hr />

    <div class="hc-list">
      <div v-if="!healthcheckStore.items.length" class="hc-list__empty">Мониторов нет. Добавьте первый!</div>

      <div v-for="hc in healthcheckStore.items" :key="hc.id" class="hc-item">
        <div class="hc-item__left">
          <div class="hc-item__name">{{ hc.name }}</div>
          <a class="hc-item__url" :href="hc.url" target="_blank" rel="noopener">{{ hc.url }}</a>
          <div class="hc-item__meta">
            {{ formatInterval(hc.interval_seconds) }} · {{ formatDate(hc.last_checked_at) }}
            <span v-if="hc.last_status === 'fail' && hc.last_error" class="hc-item__error" :title="hc.last_error">
              · {{ hc.last_error }}
            </span>
          </div>
        </div>
        <div class="hc-item__right">
          <span
            class="hc-item__status"
            :class="{
              'hc-item__status_ok': hc.last_status === 'ok',
              'hc-item__status_fail': hc.last_status === 'fail',
              'hc-item__status_unknown': hc.last_status === 'unknown',
            }"
          >
            {{ hc.last_status === 'ok' ? 'OK' : hc.last_status === 'fail' ? 'Fail' : '—' }}
          </span>
          <button
            class="button_secondary hc-item__btn"
            :class="{ 'hc-item__btn_active': hc.is_active }"
            @click="handleToggle(hc)"
          >
            {{ hc.is_active ? 'Активен' : 'Выключен' }}
          </button>
          <button class="button_secondary hc-item__btn" @click="openEdit(hc)">Редактировать</button>
          <button class="button_danger hc-item__btn" @click="handleDelete(hc)">Удалить</button>
        </div>
      </div>
    </div>

    <BaseModal ref="modal" @close="editingId = null">
      <div class="hc-modal">
        <header class="hc-modal__header">
          <div class="hc-modal__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 12H5L8 5L11 19L14 9L17 14L19 12H22" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <div>
            <h2 class="hc-modal__title">{{ editingId !== null ? 'Редактировать монитор' : 'Новый монитор' }}</h2>
            <p class="hc-modal__subtitle">Заполните параметры проверки</p>
          </div>
        </header>

        <div class="hc-modal__form">
          <div class="form-group">
            <label>Название</label>
            <input v-model="form.name" type="text" placeholder="Procarbon API" />
          </div>

          <div class="form-group">
            <label>URL для проверки</label>
            <input v-model="form.url" type="url" placeholder="https://example.com/health" />
          </div>

          <div class="hc-modal__row">
            <div class="form-group">
              <label>Интервал (сек, мин. 30)</label>
              <input v-model.number="form.interval_seconds" type="number" min="30" />
            </div>
            <div class="form-group">
              <label>Таймаут (сек)</label>
              <input v-model.number="form.timeout_seconds" type="number" min="1" max="60" />
            </div>
            <div class="form-group">
              <label>HTTP-статус</label>
              <input v-model.number="form.expected_status" type="number" min="100" max="599" />
            </div>
          </div>

          <div class="form-group">
            <label>Чат для алертов</label>
            <select v-model="form.chat_id">
              <option value="" disabled>Выберите чат...</option>
              <option v-for="c in chatStore.chatList" :key="c.chatId!" :value="c.chatId!">
                {{ c.chatName }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label>Пользователь-бот (отправитель алертов)</label>
            <select v-model.number="form.sender_user_id">
              <option :value="0" disabled>Выберите пользователя...</option>
              <option v-for="u in userStore.users" :key="u.id" :value="u.id">{{ u.first_name }} {{ u.last_name }}</option>
            </select>
          </div>
        </div>

        <footer class="hc-modal__footer">
          <button class="button_secondary" @click="modal?.close()">Отменить</button>
          <button :disabled="saving" @click="save">
            {{ saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Создать' }}
          </button>
        </footer>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
.hc-page {
  width: 100%;
  height: 100dvh;
  padding: 16px;
  min-width: 0;
  flex: 1;
  @include flex(cn);
  gap: 16px;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }

  &__header {
    @include flex(rn, between, a-center);
    gap: 16px;
    width: 100%;
  }
}

.hc-list {
  @include flex(cn);
  gap: 8px;
  width: 100%;
  overflow-y: auto;

  &__empty {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    padding: 32px;
    text-align: center;
  }
}

.hc-item {
  @include flex(rn, a-center, between);
  gap: 16px;
  @extend %ds-card;
  padding: 16px 20px;

  &__left {
    flex: 1;
    min-width: 0;
    @include flex(cn);
    gap: 2px;
  }

  &__name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__url {
    @extend %text-xs-regular;
    color: var(--primary);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 480px;

    &:hover {
      text-decoration: underline;
    }
  }

  &__meta {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    margin-top: 2px;
  }

  &__error {
    color: var(--danger-delete);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 300px;
    display: inline-block;
    vertical-align: bottom;
  }

  &__right {
    @include flex(rn, a-center);
    gap: 8px;
    flex-shrink: 0;
  }

  &__status {
    @extend %text-xs-medium;
    padding: 2px 8px;
    border-radius: 20px;
    min-width: 44px;
    text-align: center;

    &_ok {
      background: var(--green-25);
      color: var(--green);
    }

    &_fail {
      background: var(--danger-delete-25);
      color: var(--danger-delete);
    }

    &_unknown {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__btn {
    white-space: nowrap;

    &_active {
      background: var(--green-10);
      color: var(--green);
      border-color: var(--green-25);
    }
  }
}

.hc-modal {
  padding: 0 24px;
  width: 100%;

  &__header {
    @include flex(rn, a-center);
    gap: 8px;
    margin-bottom: 30px;
  }

  &__icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background-color: var(--light-text-backgroung-primary-5);
    @include flex(center);
    flex-shrink: 0;

    svg {
      stroke: var(--light-text-backgroung-primary-50);
    }
  }

  &__title {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
    margin: 0;
  }

  &__subtitle {
    margin-top: 4px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__form {
    @include flex(cn);
    gap: 16px;
    margin-bottom: 30px;
  }

  &__row {
    @include flex(rn);
    gap: 12px;

    .form-group {
      flex: 1;
    }
  }

  &__footer {
    @include flex(rn, j-end);
    gap: 12px;

    button {
      padding: 10px 32px;
    }
  }
}

.hc-modal .form-group {
  @include flex(cn);
  gap: 12px;

  label {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  input,
  select {
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: unset;
    border-radius: 8px;
    padding: 12px;
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    width: 100%;
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--primary-50);
    }
  }

  select {
    appearance: none;
    color: var(--light-text-backgroung-primary);
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path fill="%23FFFFFF" d="M1 1l5 5 5-5"/></svg>');
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;

    option {
      background-color: var(--dark-text-background-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    option:checked {
      background-color: var(--primary);
      color: var(--light-text-backgroung-primary);
    }
  }
}

.button_danger {
  background: var(--danger-delete-10);
  color: var(--danger-delete);
  border: 1px solid var(--danger-delete-25);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  @extend %text-xs-medium;

  &:hover {
    background: var(--danger-delete-25);
  }
}
</style>
