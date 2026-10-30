<script setup lang="ts">
import {
  TenantStatus,
  type CreatePlatformTenantRequest,
  type PlatformTenantSummary,
  type UpdatePlatformTenantRequest,
  type VerifyPlatformIdentityRequest,
} from '@tracker/contracts';
import { Plus, Search, Settings2, ShieldCheck, LogOut, Check, CircleAlert, Users, Building2 } from '@lucide/vue';
import PlatformDialog from '~/components/Platform/PlatformDialog.vue';

definePageMeta({ layout: 'empty-layout' });
useHead({ title: 'Клиенты | Нервион', meta: [{ name: 'robots', content: 'noindex, nofollow' }] });

const api = useTenantFetch();
const config = useRuntimeConfig();
const login = reactive({ email: '', password: '' });
const verification = reactive<VerifyPlatformIdentityRequest>({ email: '', newPassword: '', verifiedOwnership: false });
const pending = ref(false);
const feedback = ref('');
const feedbackError = ref(false);
const formOpen = ref(false);
const verificationOpen = ref(false);
const confirmingStatus = ref(false);
const formError = ref('');
const verificationError = ref('');
const editingId = ref<string | null>(null);
const search = ref('');
const feedbackElement = ref<HTMLElement | null>(null);
const formErrorElement = ref<HTMLElement | null>(null);
const verificationErrorElement = ref<HTMLElement | null>(null);
const confirmationElement = ref<HTMLElement | null>(null);
const nameElement = ref<HTMLInputElement | null>(null);

const {
  data: session,
  error: sessionError,
  refresh: refreshSession,
} = await useAsyncData('platform-session', async () => {
  try {
    return await api<{ email: string }>('/api/platform/auth/me');
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error && error.statusCode === 401) return null;
    throw error;
  }
});
const {
  data: tenants,
  error: listError,
  status: listStatus,
  refresh: refreshTenants,
} = await useAsyncData('platform-tenants', () =>
  session.value ? api<PlatformTenantSummary[]>('/api/platform/tenants') : Promise.resolve([]),
);

const statusLabels: Record<TenantStatus, string> = {
  [TenantStatus.PROVISIONING]: 'Создается',
  [TenantStatus.ACTIVE]: 'Работает',
  [TenantStatus.READ_ONLY]: 'Только чтение',
  [TenantStatus.SUSPENDED]: 'Заблокировано',
  [TenantStatus.CANCELLED]: 'Отменено',
  [TenantStatus.FAILED]: 'Ошибка создания',
};
const features = [
  { key: 'tasks', label: 'Задачи' },
  { key: 'projects', label: 'Проекты' },
  { key: 'files', label: 'Файлы' },
  { key: 'chat', label: 'Чат' },
  { key: 'wiki', label: 'Wiki' },
  { key: 'crm', label: 'CRM' },
  { key: 'reports', label: 'Отчеты' },
  { key: 'mail', label: 'Почта', optIn: true },
  { key: 'git', label: 'Git', optIn: true },
  { key: 'voice', label: 'Голос', optIn: true },
  { key: 'healthchecks', label: 'Мониторинг', optIn: true },
];
const emptyForm = () => ({
  name: '',
  slug: '',
  plan: 'standard',
  seatLimit: 10,
  paidUntil: '',
  status: TenantStatus.ACTIVE,
  featureFlags: Object.fromEntries(features.map((feature) => [feature.key, !feature.optIn])) as Record<string, boolean>,
  admin: { email: '', firstName: '', lastName: '', password: '', emailOwnershipVerified: false },
});
const form = reactive(emptyForm());
const selectedTenant = computed(() => tenants.value?.find((tenant) => tenant.id === editingId.value));
const filteredTenants = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return (tenants.value ?? []).filter((tenant) => `${tenant.name} ${tenant.hostname}`.toLocaleLowerCase().includes(query));
});
const hostnamePreview = computed(() => `${form.slug || 'client'}.${config.public.tenancyRootDomain}`);
const isAccessLocked = computed(() => form.status === TenantStatus.PROVISIONING || form.status === TenantStatus.FAILED);
const modalTitle = computed(() =>
  confirmingStatus.value
    ? form.status === TenantStatus.CANCELLED
      ? 'Отменить пространство?'
      : 'Заблокировать пространство?'
    : editingId.value
      ? 'Настройки пространства'
      : 'Новое пространство',
);
const modalDescription = computed(() =>
  confirmingStatus.value
    ? undefined
    : editingId.value
      ? selectedTenant.value?.hostname
      : 'Данные клиента, доступ и первый администратор',
);
const statusTone = (tenant: PlatformTenantSummary): string => {
  if (tenant.status === TenantStatus.FAILED || tenant.status === TenantStatus.SUSPENDED) return 'danger';
  if (tenant.readOnly || tenant.status === TenantStatus.READ_ONLY || tenant.status === TenantStatus.PROVISIONING)
    return 'warning';
  return tenant.status === TenantStatus.ACTIVE ? 'active' : 'neutral';
};

const reportFailure = async (error: Error | string) => {
  const message =
    typeof error === 'string' ? error : getErrorMessage(error) || 'Не удалось сохранить. Проверьте данные и повторите.';
  if (formOpen.value) formError.value = message;
  else if (verificationOpen.value) verificationError.value = message;
  else {
    feedbackError.value = true;
    feedback.value = message;
  }
  await nextTick();
  (formOpen.value
    ? formErrorElement.value
    : verificationOpen.value
      ? verificationErrorElement.value
      : feedbackElement.value
  )?.focus();
};
const authenticate = async () => {
  if (pending.value) return;
  pending.value = true;
  feedback.value = '';
  try {
    await api('/api/platform/auth/login', { method: 'POST', body: login });
    login.password = '';
    await refreshSession();
    await refreshTenants();
  } catch (error) {
    await reportFailure(error instanceof Error ? error : 'Не удалось войти');
  } finally {
    pending.value = false;
  }
};
const logout = async () => {
  if (pending.value) return;
  pending.value = true;
  try {
    await api('/api/platform/auth/logout', { method: 'POST' });
    session.value = null;
    tenants.value = [];
    formOpen.value = false;
    verificationOpen.value = false;
    form.admin.password = '';
    verification.newPassword = '';
    verification.verifiedOwnership = false;
    feedback.value = '';
  } catch (error) {
    await reportFailure(error instanceof Error ? error : 'Не удалось выйти');
  } finally {
    pending.value = false;
  }
};
const openForm = (tenant?: PlatformTenantSummary) => {
  editingId.value = tenant?.id ?? null;
  Object.assign(
    form,
    emptyForm(),
    tenant
      ? {
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
          seatLimit: tenant.seatLimit,
          paidUntil: tenant.paidUntil?.slice(0, 10) ?? '',
          status: tenant.status,
          featureFlags: { ...emptyForm().featureFlags, ...tenant.featureFlags },
        }
      : {},
  );
  formOpen.value = true;
  confirmingStatus.value = false;
  formError.value = '';
  feedback.value = '';
};
const closeForm = () => {
  if (pending.value) return;
  formOpen.value = false;
};
const openVerification = () => {
  Object.assign(verification, { email: '', newPassword: '', verifiedOwnership: false });
  verificationError.value = '';
  feedback.value = '';
  verificationOpen.value = true;
};
watch(formOpen, (open) => {
  if (!open) form.admin.password = '';
});
watch(verificationOpen, (open) => {
  if (!open) {
    verification.newPassword = '';
    verification.verifiedOwnership = false;
  }
});
const backToForm = async () => {
  confirmingStatus.value = false;
  await nextTick();
  nameElement.value?.focus();
};
const submit = async (confirmed = false) => {
  if (pending.value) return;
  formError.value = '';
  if (
    !confirmed &&
    editingId.value &&
    selectedTenant.value?.status !== form.status &&
    (form.status === TenantStatus.CANCELLED || form.status === TenantStatus.SUSPENDED)
  ) {
    confirmingStatus.value = true;
    await nextTick();
    confirmationElement.value?.focus();
    return;
  }
  pending.value = true;
  feedback.value = '';
  const body: UpdatePlatformTenantRequest = {
    name: form.name.trim(),
    plan: form.plan.trim(),
    seatLimit: Number(form.seatLimit),
    paidUntil: form.paidUntil ? `${form.paidUntil}T23:59:59.999Z` : null,
    featureFlags: { ...form.featureFlags },
  };
  try {
    if (editingId.value) {
      if (selectedTenant.value?.status !== form.status) body.status = form.status;
      await api(`/api/platform/tenants/${editingId.value}`, { method: 'PATCH', body });
    } else {
      const createBody: CreatePlatformTenantRequest = {
        name: body.name!,
        plan: body.plan!,
        seatLimit: body.seatLimit!,
        paidUntil: body.paidUntil ?? null,
        featureFlags: body.featureFlags!,
        slug: form.slug.trim().toLowerCase(),
        admin: { ...form.admin },
      };
      await api('/api/platform/tenants', { method: 'POST', body: createBody });
    }
    form.admin.password = '';
    feedbackError.value = false;
    feedback.value = editingId.value ? 'Изменения сохранены' : 'Пространство создано. Статус показан в списке.';
    await refreshTenants();
    pending.value = false;
    formOpen.value = false;
  } catch (error) {
    await reportFailure(error instanceof Error ? error : 'Не удалось сохранить');
  } finally {
    pending.value = false;
  }
};
const retryProvision = async (tenant: PlatformTenantSummary) => {
  if (pending.value) return;
  pending.value = true;
  try {
    await api(`/api/platform/tenants/${tenant.id}/provision`, { method: 'POST' });
    await refreshTenants();
    feedbackError.value = false;
    feedback.value = 'Создание пространства повторено';
  } catch (error) {
    await reportFailure(error instanceof Error ? error : 'Не удалось создать пространство');
  } finally {
    pending.value = false;
  }
};
const verifyIdentity = async () => {
  if (pending.value || !verification.verifiedOwnership) return;
  pending.value = true;
  verificationError.value = '';
  feedback.value = '';
  try {
    await api('/api/platform/identities/verify', { method: 'POST', body: { ...verification, email: verification.email.trim() } });
    verification.newPassword = '';
    verification.verifiedOwnership = false;
    pending.value = false;
    verificationOpen.value = false;
    feedbackError.value = false;
    feedback.value =
      'Владелец e-mail подтвержден. Пароль заменен, прежние сеансы завершены. Передайте новый пароль владельцу защищенным способом.';
  } catch (error) {
    await reportFailure(error instanceof Error ? error : 'Не удалось подтвердить владельца e-mail');
  } finally {
    pending.value = false;
  }
};
const displayDate = (date: string | null): string => (date ? date.slice(0, 10).split('-').reverse().join('.') : 'Не задана');
</script>

<template>
  <main class="platform">
    <header class="platform__header">
      <div>
        <h1>{{ session ? 'Клиенты Нервиона' : 'Управление Нервионом' }}</h1>
      </div>
      <div v-if="session" class="platform__account">
        <span>{{ session.email }}</span>
        <button class="platform-button platform-button_quiet" type="button" :disabled="pending" @click="logout">
          <LogOut :size="18" :stroke-width="1.75" aria-hidden="true" />Выйти
        </button>
      </div>
    </header>

    <div v-if="sessionError" class="platform-notice platform-notice_error" role="alert">
      <span>Не удалось проверить доступ.</span>
      <button class="platform-button platform-button_secondary" type="button" @click="refreshSession()">Повторить</button>
    </div>
    <div
      v-if="feedback"
      ref="feedbackElement"
      class="platform-notice"
      :class="{ 'platform-notice_error': feedbackError }"
      tabindex="-1"
      :role="feedbackError ? 'alert' : 'status'"
    >
      <CircleAlert v-if="feedbackError" :size="18" aria-hidden="true" />
      <Check v-else :size="18" aria-hidden="true" />
      <span>{{ feedback }}</span>
    </div>

    <form
      v-if="!session && !sessionError"
      class="platform__login platform-form"
      :aria-busy="pending"
      @submit.prevent="authenticate"
    >
      <div class="platform__login-heading">
        <ShieldCheck :size="24" :stroke-width="1.75" aria-hidden="true" />
        <h2>Вход администратора</h2>
      </div>
      <label class="platform-form__field">
        E-mail
        <input
          v-model="login.email"
          name="email"
          type="email"
          placeholder="admin@example.ru"
          autocomplete="username"
          required
          :disabled="pending"
        />
      </label>
      <label class="platform-form__field">
        Пароль
        <input
          v-model="login.password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="pending"
        />
      </label>
      <button class="platform-button" type="submit" :disabled="pending">{{ pending ? 'Входим...' : 'Войти' }}</button>
    </form>

    <template v-if="session">
      <div class="platform__toolbar">
        <label class="platform__search">
          <span class="platform__sr-only">Поиск клиента</span>
          <Search :size="18" :stroke-width="1.75" aria-hidden="true" />
          <input v-model="search" type="search" placeholder="Название или поддомен" />
        </label>
        <div class="platform__actions">
          <button class="platform-button platform-button_secondary" type="button" :disabled="pending" @click="openVerification">
            <ShieldCheck :size="18" :stroke-width="1.75" aria-hidden="true" />Подтвердить владельца
          </button>
          <button class="platform-button" type="button" :disabled="pending" @click="openForm()">
            <Plus :size="18" :stroke-width="1.75" aria-hidden="true" />Создать пространство
          </button>
        </div>
      </div>

      <div v-if="listError" class="platform-notice platform-notice_error" role="alert">
        <span>Не удалось загрузить клиентов.</span>
        <button class="platform-button platform-button_secondary" type="button" @click="refreshTenants()">Повторить</button>
      </div>
      <p v-else-if="listStatus === 'pending'" class="platform__empty" role="status">Загружаем клиентов...</p>
      <div v-else-if="!filteredTenants.length" class="platform__empty">
        <Building2 :size="28" :stroke-width="1.75" aria-hidden="true" />
        <h2>{{ search ? 'Клиенты не найдены' : 'Клиентов пока нет' }}</h2>
        <p>{{ search ? 'Попробуйте другое название или поддомен.' : 'Создайте первое пространство для клиента.' }}</p>
        <button v-if="search" class="platform-button platform-button_secondary" type="button" @click="search = ''">
          Сбросить поиск
        </button>
      </div>
      <div v-else class="platform__table" tabindex="0" aria-label="Список клиентов">
        <table>
          <thead>
            <tr>
              <th scope="col">Клиент</th>
              <th scope="col">Доступ</th>
              <th scope="col">Тариф</th>
              <th scope="col">Пользователи</th>
              <th scope="col">Оплачено по</th>
              <th scope="col"><span class="platform__sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tenant in filteredTenants" :key="tenant.id">
              <td class="platform__client" data-label="Клиент">
                <strong>{{ tenant.name }}</strong>
                <span class="platform__hostname">{{ tenant.hostname }}</span>
                <span v-if="tenant.provisioningError" class="platform__failure">{{ tenant.provisioningError }}</span>
              </td>
              <td data-label="Доступ">
                <span class="platform__status" :class="'platform__status_' + statusTone(tenant)">
                  {{ tenant.readOnly && tenant.status === TenantStatus.ACTIVE ? 'Только чтение' : statusLabels[tenant.status] }}
                </span>
                <small v-if="tenant.readOnly && tenant.status === TenantStatus.ACTIVE">Срок оплаты истек</small>
                <small v-if="tenant.retentionUntil">Хранить до {{ displayDate(tenant.retentionUntil) }}</small>
              </td>
              <td data-label="Тариф">{{ tenant.plan }}</td>
              <td data-label="Пользователи">
                <span class="platform__seats"
                  ><Users :size="16" :stroke-width="1.75" aria-hidden="true" />{{ tenant.activeSeats }} /
                  {{ tenant.seatLimit }}</span
                >
              </td>
              <td data-label="Оплачено по">{{ displayDate(tenant.paidUntil) }}</td>
              <td class="platform__row-actions">
                <button
                  class="platform-button platform-button_secondary platform-button_icon"
                  type="button"
                  :disabled="pending"
                  :aria-label="'Настроить ' + tenant.name"
                  :title="'Настроить ' + tenant.name"
                  @click="openForm(tenant)"
                >
                  <Settings2 :size="20" :stroke-width="1.75" aria-hidden="true" />
                </button>
                <button
                  v-if="tenant.status === TenantStatus.FAILED"
                  class="platform-button platform-button_secondary"
                  type="button"
                  :disabled="pending"
                  @click="retryProvision(tenant)"
                >
                  Повторить создание
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </main>

  <PlatformDialog
    v-model="formOpen"
    :title="modalTitle"
    :description="modalDescription"
    :wide="!confirmingStatus"
    :busy="pending"
  >
    <div v-if="formError" ref="formErrorElement" class="platform-notice platform-notice_error" role="alert" tabindex="-1">
      {{ formError }}
    </div>

    <div v-if="confirmingStatus" class="platform-form">
      <p ref="confirmationElement" class="platform-form__confirmation" tabindex="-1">
        <template v-if="form.status === TenantStatus.CANCELLED">
          Доступ к пространству <strong>{{ form.name }}</strong> будет закрыт. Данные сохранятся на 90 дней для восстановления.
        </template>
        <template v-else>
          Все пользователи пространства <strong>{{ form.name }}</strong> потеряют доступ. Его можно будет восстановить в
          настройках.
        </template>
      </p>
      <p class="platform-form__hint">Остальные изменения настроек тоже будут сохранены.</p>
    </div>
    <form v-else id="platform-tenant-form" class="platform-form" :aria-busy="pending" @submit.prevent="submit()">
      <fieldset :disabled="pending" class="platform-form__section">
        <legend>Пространство</legend>
        <div class="platform-form__grid">
          <label class="platform-form__field">
            Название клиента
            <input
              ref="nameElement"
              v-model="form.name"
              data-autofocus
              required
              maxlength="160"
              autocomplete="organization"
              placeholder="Название компании"
            />
          </label>
          <label class="platform-form__field">
            Поддомен
            <input
              v-model="form.slug"
              required
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              minlength="2"
              maxlength="63"
              :readonly="Boolean(editingId)"
              autocapitalize="none"
              spellcheck="false"
              placeholder="client"
              aria-describedby="platform-hostname-hint"
            />
            <small id="platform-hostname-hint">{{ hostnamePreview }}{{ editingId ? ' · Нельзя изменить' : '' }}</small>
          </label>
          <label class="platform-form__field">
            Тариф
            <input v-model="form.plan" required maxlength="80" placeholder="standard" />
          </label>
          <label class="platform-form__field">
            Лимит пользователей
            <input
              v-model.number="form.seatLimit"
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              :aria-describedby="selectedTenant ? 'platform-seats-hint' : undefined"
            />
            <small v-if="selectedTenant" id="platform-seats-hint">Занято мест: {{ selectedTenant.activeSeats }}</small>
          </label>
          <label class="platform-form__field">
            Оплачено по
            <input v-model="form.paidUntil" type="date" aria-describedby="platform-payment-hint" />
            <small id="platform-payment-hint"
              >Включительно, по UTC. Затем 7 дней отсрочки и режим чтения. Пустая дата: без ограничения.</small
            >
          </label>
          <label v-if="editingId" class="platform-form__field">
            Доступ
            <select v-model="form.status" :disabled="isAccessLocked">
              <option :value="TenantStatus.ACTIVE">Работает</option>
              <option :value="TenantStatus.READ_ONLY">Только чтение</option>
              <option :value="TenantStatus.SUSPENDED">Заблокировано</option>
              <option :value="TenantStatus.CANCELLED">Отменено</option>
              <option v-if="form.status === TenantStatus.PROVISIONING" :value="TenantStatus.PROVISIONING">Создается</option>
              <option v-if="form.status === TenantStatus.FAILED" :value="TenantStatus.FAILED">Ошибка создания</option>
            </select>
            <small v-if="isAccessLocked">Статус изменится после создания пространства.</small>
          </label>
        </div>
      </fieldset>

      <fieldset :disabled="pending" class="platform-form__section">
        <legend>Функции пространства</legend>
        <div class="platform-form__features">
          <label v-for="feature in features" :key="feature.key" class="platform-form__checkbox">
            <input v-model="form.featureFlags[feature.key]" type="checkbox" />{{ feature.label }}
          </label>
        </div>
        <p class="platform-form__hint">Перед включением почты, Git, голоса и мониторинга настройте подключения на сервере.</p>
      </fieldset>

      <fieldset v-if="!editingId" :disabled="pending" class="platform-form__section">
        <legend>Первый администратор</legend>
        <div class="platform-form__grid">
          <label class="platform-form__field">
            Имя
            <input v-model="form.admin.firstName" required maxlength="100" autocomplete="given-name" placeholder="Имя" />
          </label>
          <label class="platform-form__field">
            Фамилия
            <input v-model="form.admin.lastName" required maxlength="100" autocomplete="family-name" placeholder="Фамилия" />
          </label>
          <label class="platform-form__field">
            E-mail
            <input v-model="form.admin.email" type="email" required autocomplete="off" placeholder="name@company.ru" />
          </label>
          <label class="platform-form__field">
            Временный пароль
            <input
              v-model="form.admin.password"
              type="password"
              minlength="12"
              maxlength="128"
              required
              autocomplete="new-password"
              aria-describedby="platform-admin-password-hint"
            />
            <small id="platform-admin-password-hint">Минимум 12 символов.</small>
          </label>
        </div>
        <label class="platform-form__checkbox platform-form__checkbox_ownership">
          <input v-model="form.admin.emailOwnershipVerified" type="checkbox" aria-describedby="platform-admin-ownership-hint" />
          Я подтвердил владение e-mail администратора
        </label>
        <p id="platform-admin-ownership-hint" class="platform-form__hint">
          Отмечайте после личной проверки. Без подтверждения учетная запись доступна только в этом пространстве.
        </p>
      </fieldset>
    </form>

    <template #footer>
      <template v-if="confirmingStatus">
        <button class="platform-button platform-button_secondary" type="button" :disabled="pending" @click="backToForm">
          Назад к настройкам
        </button>
        <button class="platform-button platform-button_danger" type="button" :disabled="pending" @click="submit(true)">
          {{ pending ? 'Сохраняем...' : form.status === TenantStatus.CANCELLED ? 'Отменить пространство' : 'Заблокировать' }}
        </button>
      </template>
      <template v-else>
        <button class="platform-button platform-button_secondary" type="button" :disabled="pending" @click="closeForm">
          Отмена
        </button>
        <button class="platform-button" type="submit" form="platform-tenant-form" :disabled="pending">
          {{ pending ? 'Сохраняем...' : editingId ? 'Сохранить изменения' : 'Создать пространство' }}
        </button>
      </template>
    </template>
  </PlatformDialog>

  <PlatformDialog
    v-model="verificationOpen"
    title="Подтвердить владельца"
    description="Для существующей учетной записи"
    :busy="pending"
  >
    <form id="platform-verification-form" class="platform-form" :aria-busy="pending" @submit.prevent="verifyIdentity">
      <div
        v-if="verificationError"
        ref="verificationErrorElement"
        class="platform-notice platform-notice_error"
        role="alert"
        tabindex="-1"
      >
        {{ verificationError }}
      </div>
      <div id="identity-verification-help" class="platform-notice platform-notice_warning">
        <ShieldCheck :size="20" :stroke-width="1.75" aria-hidden="true" />
        <p>
          Пароль будет заменен, все сеансы пользователя во всех пространствах завершатся. Передайте новый пароль владельцу
          защищенным способом.
        </p>
      </div>
      <fieldset :disabled="pending" class="platform-form__section">
        <label class="platform-form__field">
          E-mail пользователя
          <input
            v-model="verification.email"
            data-autofocus
            type="email"
            required
            autocomplete="off"
            placeholder="name@company.ru"
            aria-describedby="identity-verification-help"
          />
        </label>
        <label class="platform-form__field">
          Новый пароль
          <input
            v-model="verification.newPassword"
            type="password"
            minlength="12"
            maxlength="128"
            required
            autocomplete="new-password"
            aria-describedby="platform-verification-password-hint"
          />
          <small id="platform-verification-password-hint">Минимум 12 символов.</small>
        </label>
        <label class="platform-form__checkbox platform-form__checkbox_ownership">
          <input v-model="verification.verifiedOwnership" type="checkbox" required />
          Я лично проверил, что этот e-mail принадлежит пользователю
        </label>
      </fieldset>
    </form>
    <template #footer>
      <button
        class="platform-button platform-button_secondary"
        type="button"
        :disabled="pending"
        @click="verificationOpen = false"
      >
        Отмена
      </button>
      <button
        class="platform-button"
        type="submit"
        form="platform-verification-form"
        :disabled="pending || !verification.verifiedOwnership"
      >
        {{ pending ? 'Сохраняем...' : 'Подтвердить и сменить пароль' }}
      </button>
    </template>
  </PlatformDialog>
</template>

<style scoped lang="scss">
.platform {
  width: 100%;
  min-width: 0;
  min-height: 100dvh;
  padding: 24px;
  color: var(--light-text-backgroung-primary);
  @include flex(cn);
  gap: 24px;
  @extend %text-s-regular;

  h1 {
    margin: 0;
    @extend %display-xs-medium;
  }
  h2 {
    margin: 0;
    @extend %h1;
  }
  p {
    margin: 0;
  }

  &__header {
    @include flex(rn, between, a-center);
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }
  &__account {
    @include flex(rw, a-center);
    gap: 12px;
    min-width: 0;
    > span {
      color: var(--light-text-backgroung-primary-50);
      overflow-wrap: anywhere;
    }
  }
  &__toolbar {
    @include flex(rw, between, a-center);
    gap: 16px;
  }
  &__actions {
    @include flex(rw, a-center);
    gap: 8px;
  }
  &__search {
    position: relative;
    width: min(100%, 340px);
    > svg {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--light-text-backgroung-primary-50);
      pointer-events: none;
    }
    input {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px 10px 40px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: inherit;
      @extend %text-s-regular;
      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }
    }
  }
  &__login {
    width: min(100%, 420px);
    margin: 40px auto;
    padding: 24px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    background: var(--dark-text-background-primary);
  }
  &__login-heading {
    margin-bottom: 8px;
    > svg {
      margin-bottom: 16px;
      color: var(--light-text-backgroung-primary-50);
    }
  }
  &__table {
    max-width: 100%;
    overflow: auto;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    background: var(--light-text-backgroung-primary-5);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  th,
  td {
    padding: 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    vertical-align: middle;
  }
  th {
    background: var(--dark-text-background-primary);
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-medium;
    white-space: nowrap;
  }
  td {
    min-width: 100px;
    max-width: 320px;
    overflow-wrap: anywhere;
  }
  td[data-label]::before {
    @extend %text-xs-regular;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover {
    background: var(--light-text-backgroung-primary-5);
  }
  small {
    display: block;
    margin-top: 6px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }
  &__client {
    min-width: 200px;
    strong {
      @extend %text-s-medium;
    }
  }
  &__hostname {
    display: block;
    margin-top: 4px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-xs-regular;
  }
  &__failure {
    display: block;
    margin-top: 8px;
    @extend %text-xs-regular;
  }
  &__status {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-5);
    @extend %text-xs-medium;
    &_active {
      color: var(--green);
      background: var(--green-10);
    }
    &_warning {
      color: var(--status-in-progress);
      background: var(--status-in-progress-15);
    }
    &_danger {
      background: var(--danger-delete-10);
    }
  }
  &__seats {
    @include flex(rn, a-center);
    gap: 8px;
    > svg {
      color: var(--light-text-backgroung-primary-50);
      flex-shrink: 0;
    }
  }
  &__row-actions {
    width: 1%;
    > button:not(.platform-button_icon) {
      width: 100%;
    }
    > button + button {
      margin-top: 8px;
    }
  }
  &__empty {
    @include flex(cn, center);
    gap: 12px;
    padding: 64px 24px;
    text-align: center;
    color: var(--light-text-backgroung-primary-50);
    h2 {
      @extend %text-l-medium;
      color: var(--light-text-backgroung-primary);
    }
  }
  &__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
}

.platform-button {
  min-height: 44px;
  padding: 10px 16px;
  gap: 8px;
  @extend %text-s-medium;
  white-space: normal;
  line-height: 1.4;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;
  svg {
    flex-shrink: 0;
  }
  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
  &_icon {
    flex: 0 0 44px;
    width: 44px;
    min-width: 44px;
    height: 44px;
    padding: 0;
  }
  &_secondary {
    background: var(--light-text-backgroung-primary-5);
    border-color: var(--light-text-backgroung-primary-10);
  }
  &_quiet {
    background: transparent;
  }
  &_secondary,
  &_quiet {
    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-10);
    }
  }
  &_danger {
    background: var(--danger-delete-10);
    border-color: var(--danger-delete-50);
    &:hover:not(:disabled) {
      background: var(--danger-delete-25);
    }
  }
}

.platform-form {
  @include flex(cn);
  gap: 24px;
  min-width: 0;
  @extend %text-s-regular;
  color: var(--light-text-backgroung-primary);

  &__section {
    @include flex(cn);
    gap: 16px;
    padding: 0;
    margin: 0;
    min-width: 0;
    border: 0;
    & + & {
      padding-top: 24px;
      border-top: 1px solid var(--light-text-backgroung-primary-10);
    }
    legend {
      padding: 0 0 16px;
      @extend %text-s-medium;
    }
  }
  &__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  &__field {
    @include flex(cn);
    gap: 8px;
    min-width: 0;
    @extend %text-xs-medium;
    input,
    select {
      width: 100%;
      min-height: 44px;
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 8px;
      background-color: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
      color-scheme: dark;
      @extend %text-s-regular;
      &::placeholder {
        color: var(--light-text-backgroung-primary-50);
      }
      &[readonly],
      &:disabled {
        color: var(--light-text-backgroung-primary-50);
      }
    }
    option {
      background: var(--dark-text-background-primary);
    }
    small {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
      overflow-wrap: anywhere;
    }
  }
  &__features {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 16px;
  }
  &__checkbox {
    @include flex(rn, a-center);
    gap: 10px;
    min-width: 0;
    min-height: 44px;
    cursor: pointer;
    input {
      width: 18px;
      height: 18px;
      margin: 0;
      flex-shrink: 0;
      accent-color: var(--primary);
    }
    &_ownership {
      align-items: flex-start;
      input {
        margin-top: 2px;
      }
    }
  }
  &__hint {
    margin: 0;
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }
  &__confirmation {
    margin: 0;
    overflow-wrap: anywhere;
    @extend %text-m-regular;
  }
}

.platform-notice {
  @include flex(rn, a-start);
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);
  color: var(--light-text-backgroung-primary);
  overflow-wrap: anywhere;
  @extend %text-s-regular;
  svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
  p {
    margin: 0;
  }
  &_error {
    border-color: var(--danger-delete-50);
    background: var(--danger-delete-10);
  }
  &_warning {
    background: var(--status-in-progress-15);
    border-color: var(--light-text-backgroung-primary-10);
    > svg {
      color: var(--status-in-progress);
    }
  }
  + .platform-form {
    margin-top: 16px;
  }
}

.platform :is(button, input, [tabindex='0']),
.platform-button,
.platform-form :is(input, select),
.platform-notice {
  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 3px;
  }
}

@media (max-width: $screen-desktop-l) {
  .platform {
    &__toolbar {
      align-items: stretch;
    }
    &__search {
      width: 100%;
    }
  }
}

@media (max-width: $screen-tablet) {
  .platform {
    padding: 16px;
    gap: 16px;
    &__header {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      padding-bottom: 16px;
    }
    &__account {
      justify-content: space-between;
    }
    &__actions {
      width: 100%;
      > button {
        flex: 1;
      }
    }
    &__table {
      overflow: visible;
      border: 0;
      background: transparent;
      border-radius: 0;
    }
    table,
    tbody {
      display: block;
    }
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
      border: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 12px;
      background: var(--light-text-backgroung-primary-5);
      + tr {
        margin-top: 12px;
      }
    }
    th,
    td {
      display: block;
      min-width: 0;
      max-width: none;
      padding: 0;
      border: 0;
    }
    td[data-label]:not(.platform__client)::before {
      content: attr(data-label);
      display: block;
      margin-bottom: 6px;
      color: var(--light-text-backgroung-primary-50);
    }
    &__client {
      grid-column: 1 / -1;
    }
    &__row-actions {
      grid-column: 1 / -1;
      width: auto;
    }
    &__login {
      margin: 16px auto;
    }
  }
  .platform-form {
    &__grid {
      grid-template-columns: minmax(0, 1fr);
    }
    &__features {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .platform-button {
    transition: none;
  }
}
</style>
