<script setup lang="ts">
import { definePageMeta } from '#imports';
import { HEALTHCHECK_MAX_TIMEOUT_SECONDS } from '@tracker/contracts';
import PlatformDialog from '~/components/Platform/PlatformDialog.vue';
import { ROLES } from '~/types/user';
import { useHealthcheckStore, type HealthCheck, type CreateHealthCheckDto } from '~/stores/healthcheckStore';
import { useChatStore } from '~/stores/chatStore';
import { getErrorMessage } from '~/utils/error';

definePageMeta({
  middleware: ['auth', 'role'],
  roles: [ROLES.admin],
});

const { $toast } = useNuxtApp();
const healthcheckStore = useHealthcheckStore();
const chatStore = useChatStore();
const userStore = useUserStore();
const tenantStore = useTenantStore();

const modalOpen = ref(false);
const deleteOpen = ref(false);
const deleteTarget = ref<HealthCheck | null>(null);
const editingId = ref<number | null>(null);
const saving = ref(false);
const deleting = ref(false);
const pendingIds = ref(new Set<number>());
const formError = ref('');
const actionError = ref('');
const deleteError = ref('');
const errorSummary = ref<HTMLElement | null>(null);
const timeoutMax = HEALTHCHECK_MAX_TIMEOUT_SECONDS;
const canWrite = computed(
  () => !tenantStore.readOnly && (!tenantStore.enabled || Boolean(tenantStore.tenant)) && tenantStore.canUse('healthchecks'),
);
const actionPending = computed(() => saving.value || deleting.value || pendingIds.value.size > 0);
const formId = `healthcheck-${useId()}`;

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

const {
  error: loadError,
  pending: loading,
  refresh: reload,
} = await useAsyncData('healthchecks-init', async () => {
  await Promise.all([
    healthcheckStore.fetchAll(),
    ...(tenantStore.canUse('chat') ? [chatStore.fetchChatList()] : []),
    userStore.fetchUsers(),
  ]);
  return true;
});

const openCreate = () => {
  if (!canWrite.value || actionPending.value || loadError.value) return;
  editingId.value = null;
  formError.value = '';
  form.value = defaultForm();
  modalOpen.value = true;
};

const openEdit = (hc: HealthCheck) => {
  if (!canWrite.value || actionPending.value || loadError.value) return;
  editingId.value = hc.id;
  formError.value = '';
  form.value = {
    name: hc.name,
    url: hc.url,
    interval_seconds: hc.interval_seconds,
    timeout_seconds: hc.timeout_seconds,
    expected_status: hc.expected_status,
    chat_id: hc.chat_id,
    sender_user_id: hc.sender_user_id,
  };
  modalOpen.value = true;
};

const showFormError = async (message: string) => {
  formError.value = message;
  await nextTick();
  errorSummary.value?.focus();
};

const save = async () => {
  if (saving.value) return;
  if (!canWrite.value) {
    await showFormError(
      tenantStore.readOnly
        ? 'Пространство доступно только для чтения. Изменения не сохранены.'
        : 'Управление мониторингом сейчас недоступно. Обновите страницу.',
    );
    return;
  }
  formError.value = '';
  if (!form.value.name.trim()) {
    await showFormError('Введите название монитора.');
    return;
  }
  if (!form.value.url.trim()) {
    await showFormError('Введите полный URL для проверки.');
    return;
  }
  if (!form.value.chat_id) {
    await showFormError('Выберите чат для уведомлений.');
    return;
  }
  if (!form.value.sender_user_id) {
    await showFormError('Выберите пользователя, от имени которого будут приходить уведомления.');
    return;
  }
  if (!Number.isInteger(form.value.interval_seconds) || form.value.interval_seconds < 30 || form.value.interval_seconds > 86400) {
    await showFormError('Интервал проверки должен быть целым числом от 30 до 86400 секунд.');
    return;
  }
  const timeout = form.value.timeout_seconds ?? 10;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > timeoutMax) {
    await showFormError(`Таймаут должен быть целым числом от 1 до ${timeoutMax} секунд.`);
    return;
  }
  const status = form.value.expected_status ?? 200;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    await showFormError('Укажите ожидаемый HTTP-статус от 100 до 599.');
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
    modalOpen.value = false;
  } catch (error) {
    await showFormError(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
};

const handleToggle = async (hc: HealthCheck) => {
  if (!canWrite.value || actionPending.value) return;
  pendingIds.value = new Set(pendingIds.value).add(hc.id);
  actionError.value = '';
  try {
    await healthcheckStore.toggle(hc.id);
  } catch (error) {
    actionError.value = getErrorMessage(error);
  } finally {
    const next = new Set(pendingIds.value);
    next.delete(hc.id);
    pendingIds.value = next;
  }
};

const openDelete = (hc: HealthCheck) => {
  if (!canWrite.value || actionPending.value) return;
  deleteTarget.value = hc;
  deleteError.value = '';
  deleteOpen.value = true;
};

const handleDelete = async () => {
  if (!deleteTarget.value || deleting.value) return;
  if (!canWrite.value) {
    deleteError.value = tenantStore.readOnly
      ? 'Пространство доступно только для чтения. Монитор не удален.'
      : 'Управление мониторингом сейчас недоступно. Монитор не удален.';
    return;
  }
  deleting.value = true;
  deleteError.value = '';
  try {
    await healthcheckStore.remove(deleteTarget.value.id);
    deleteOpen.value = false;
    $toast.trash('Удалено');
  } catch (error) {
    deleteError.value = getErrorMessage(error);
  } finally {
    deleting.value = false;
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
      <button
        type="button"
        class="button"
        :disabled="!canWrite || actionPending || loading || Boolean(loadError)"
        @click="openCreate"
      >
        <IconsIconPlus />
        Добавить монитор
      </button>
    </header>
    <hr />
    <p v-if="tenantStore.readOnly" class="hc-page__notice" role="status">
      Пространство доступно только для чтения. Настройки мониторинга нельзя менять.
    </p>
    <div v-if="loadError" class="hc-page__error" role="alert">
      <p>{{ getErrorMessage(loadError) }}</p>
      <button type="button" class="button_secondary" :disabled="loading || actionPending" @click="reload()">
        Повторить загрузку
      </button>
    </div>
    <p v-if="actionError" class="hc-page__error" role="alert">{{ actionError }}</p>

    <div class="hc-list" :aria-busy="loading">
      <div v-if="loading" class="hc-list__empty" role="status">Загрузка мониторов...</div>
      <div v-else-if="!healthcheckStore.items.length && !loadError" class="hc-list__empty">Мониторов пока нет.</div>

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
            {{ hc.last_status === 'ok' ? 'Доступен' : hc.last_status === 'fail' ? 'Ошибка' : 'Нет данных' }}
          </span>
          <button
            class="button_secondary hc-item__btn"
            type="button"
            :class="{ 'hc-item__btn_active': hc.is_active }"
            :disabled="!canWrite || actionPending"
            :aria-pressed="hc.is_active"
            @click="handleToggle(hc)"
          >
            {{ pendingIds.has(hc.id) ? 'Сохранение...' : hc.is_active ? 'Активен' : 'Выключен' }}
          </button>
          <button
            type="button"
            class="button_secondary hc-item__btn"
            :disabled="!canWrite || actionPending || Boolean(loadError)"
            @click="openEdit(hc)"
          >
            Редактировать
          </button>
          <button type="button" class="button_danger hc-item__btn" :disabled="!canWrite || actionPending" @click="openDelete(hc)">
            Удалить
          </button>
        </div>
      </div>
    </div>

    <PlatformDialog
      v-model="modalOpen"
      :title="editingId !== null ? 'Редактировать монитор' : 'Новый монитор'"
      description="Проверка доступности и уведомления в чат"
      :busy="saving"
    >
      <form :id="formId" class="hc-modal" :aria-busy="saving" @submit.prevent="save">
        <p v-if="tenantStore.readOnly" class="hc-modal__hint" role="status">
          Пространство перешло в режим только чтения. Изменения недоступны.
        </p>
        <p v-if="formError" :id="`${formId}-error`" ref="errorSummary" class="hc-modal__error" role="alert" tabindex="-1">
          {{ formError }}
        </p>
        <fieldset
          class="hc-modal__form"
          :disabled="saving || !canWrite"
          :aria-describedby="formError ? `${formId}-error` : undefined"
        >
          <legend class="hc-modal__legend">Параметры монитора</legend>
          <div class="form-group">
            <label :for="`${formId}-name`">Название</label>
            <input
              :id="`${formId}-name`"
              v-model="form.name"
              name="name"
              type="text"
              maxlength="255"
              required
              placeholder="Сайт компании"
              data-autofocus
            />
          </div>

          <div class="form-group">
            <label :for="`${formId}-url`">URL для проверки</label>
            <input
              :id="`${formId}-url`"
              v-model="form.url"
              name="url"
              type="url"
              maxlength="1000"
              required
              placeholder="https://example.com/health"
              :aria-describedby="tenantStore.enabled ? `${formId}-url-hint` : undefined"
            />
            <p v-if="tenantStore.enabled" :id="`${formId}-url-hint`" class="hc-modal__hint">
              Домен должен быть разрешен оператором платформы для вашего пространства.
            </p>
          </div>

          <div class="hc-modal__row">
            <div class="form-group">
              <label :for="`${formId}-interval`">Интервал, сек.</label>
              <input
                :id="`${formId}-interval`"
                v-model.number="form.interval_seconds"
                name="interval"
                type="number"
                inputmode="numeric"
                min="30"
                max="86400"
                step="1"
                required
                :aria-describedby="`${formId}-interval-hint`"
              />
              <p :id="`${formId}-interval-hint`" class="hc-modal__hint">От 30 до 86400</p>
            </div>
            <div class="form-group">
              <label :for="`${formId}-timeout`">Таймаут, сек.</label>
              <input
                :id="`${formId}-timeout`"
                v-model.number="form.timeout_seconds"
                name="timeout"
                type="number"
                inputmode="numeric"
                min="1"
                :max="timeoutMax"
                step="1"
                required
                :aria-describedby="`${formId}-timeout-hint`"
              />
              <p :id="`${formId}-timeout-hint`" class="hc-modal__hint">От 1 до {{ timeoutMax }}</p>
            </div>
            <div class="form-group">
              <label :for="`${formId}-status`">HTTP-статус</label>
              <input
                :id="`${formId}-status`"
                v-model.number="form.expected_status"
                name="expected-status"
                type="number"
                inputmode="numeric"
                min="100"
                max="599"
                step="1"
                required
              />
            </div>
          </div>

          <div class="form-group">
            <label :for="`${formId}-chat`">Чат для уведомлений</label>
            <select :id="`${formId}-chat`" v-model="form.chat_id" name="chat" required :aria-describedby="`${formId}-chat-hint`">
              <option value="" disabled>Выберите чат...</option>
              <option v-for="c in chatStore.chatList" :key="c.chatId!" :value="c.chatId!">
                {{ c.chatName }}
              </option>
            </select>
            <p :id="`${formId}-chat-hint`" class="hc-modal__hint">Отправитель должен состоять в выбранном чате.</p>
          </div>

          <div class="form-group">
            <label :for="`${formId}-sender`">Отправитель уведомлений</label>
            <select :id="`${formId}-sender`" v-model.number="form.sender_user_id" name="sender" required>
              <option :value="0" disabled>Выберите пользователя...</option>
              <option v-for="u in userStore.users" :key="u.id" :value="u.id">{{ u.first_name }} {{ u.last_name }}</option>
            </select>
          </div>
        </fieldset>
      </form>
      <template #footer>
        <button type="button" class="button_secondary" :disabled="saving" @click="modalOpen = false">Отмена</button>
        <button type="submit" class="button" :form="formId" :disabled="saving || !canWrite">
          {{ saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Создать' }}
        </button>
      </template>
    </PlatformDialog>

    <PlatformDialog v-model="deleteOpen" title="Удалить монитор?" :busy="deleting">
      <p v-if="tenantStore.readOnly" class="hc-modal__hint" role="status">
        Пространство доступно только для чтения. Удаление недоступно.
      </p>
      <p class="hc-modal__description">
        Проверки "{{ deleteTarget?.name }}" и уведомления о его доступности прекратятся. Восстановить монитор после удаления
        нельзя.
      </p>
      <p v-if="deleteError" class="hc-modal__error" role="alert">{{ deleteError }}</p>
      <template #footer>
        <button type="button" class="button_secondary" :disabled="deleting" data-autofocus @click="deleteOpen = false">
          Отмена
        </button>
        <button type="button" class="button_danger" :disabled="deleting || !canWrite" @click="handleDelete">
          {{ deleting ? 'Удаление...' : 'Удалить монитор' }}
        </button>
      </template>
    </PlatformDialog>
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

  &__notice,
  &__error {
    @extend %text-s-regular;
    margin: 0;
    overflow-wrap: anywhere;
  }

  &__notice {
    color: var(--light-text-backgroung-primary-50);
  }

  &__error {
    color: var(--danger-delete);

    p {
      margin: 0 0 12px;
    }
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: $screen-tablet) {
    &__header {
      @include flex(cn, a-start);
    }
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
    overflow-wrap: anywhere;
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
    font-variant-numeric: tabular-nums;
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
    min-height: 44px;

    &_active {
      background: var(--green-10);
      color: var(--green);
      border-color: var(--green-25);
    }
  }

  @media (max-width: $screen-desktop-l) {
    @include flex(cn, a-start);

    &__left {
      width: 100%;
    }

    &__right {
      @include flex(rw, a-center);
      max-width: 100%;
    }
  }
}

.hc-modal {
  width: 100%;
  min-width: 0;

  &__form {
    @include flex(cn);
    gap: 16px;
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  &__legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  &__hint {
    @extend %text-xs-regular;
    margin: 0;
    color: var(--light-text-backgroung-primary-50);
  }

  &__description {
    @extend %text-s-regular;
    margin: 0;
    overflow-wrap: anywhere;
  }

  &__error {
    @extend %text-s-regular;
    margin: 0 0 16px;
    color: var(--danger-delete);
    overflow-wrap: anywhere;

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 4px;
    }
  }

  &__row {
    @include flex(rn);
    gap: 12px;

    .form-group {
      flex: 1;
      min-width: 0;
    }
  }

  @media (max-width: $screen-mobile-l) {
    &__row {
      @include flex(cn);
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
    @extend %text-m-regular;
    color: var(--light-text-backgroung-primary);
    width: 100%;
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--primary-50);
    }
  }

  select {
    color: var(--light-text-backgroung-primary);

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
  min-height: 44px;
  padding: 8px 12px;
  cursor: pointer;
  @extend %text-xs-medium;

  &:hover:not(:disabled) {
    background: var(--danger-delete-25);
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}
</style>
