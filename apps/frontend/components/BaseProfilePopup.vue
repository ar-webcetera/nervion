<script lang="ts" setup>
import { roleNames } from '~/types/user';
import { MENU_ITEMS, isMenuItemAllowedForRole } from '~/constants/menu.constants';
import { getErrorMessage } from '~/utils/error';
import IconLogout from './Icons/IconLogout.vue';
import type BaseModal from './BaseModal.vue';
import IconPen from './Icons/IconPen.vue';
import AvatarCropperModal from './AvatarCropperModal.vue';
import IconDeleteSimple from './Icons/IconDeleteSimple.vue';
import IconCopy from './Icons/IconCopy.vue';
import IconLongBack from './Icons/IconLongBack.vue';

const { getUserInfo, openUserEditModal, userEditModal, closeUserEditModal, handleLogout } = useProfile();
const { formatMessageDate } = useDateFormatter();
const config = useRuntimeConfig();
const authStore = useAuthStore();

const emit = defineEmits(['close']);

const userInfo = computed(() => getUserInfo.value);
const avatarCropper = ref<InstanceType<typeof AvatarCropperModal> | null>(null);

const userStore = useUserStore();
const { $toast } = useNuxtApp();

const configurableMenuItems = computed(() =>
  MENU_ITEMS.filter((item) => !item.always && isMenuItemAllowedForRole(item, userInfo.value?.role)),
);
const isMenuItemVisible = (key: string) => !(userInfo.value?.hidden_menu_items ?? []).includes(key);
const savingMenu = ref(false);
const toggleMenuItem = async (key: string) => {
  const hidden = new Set(userInfo.value?.hidden_menu_items ?? []);
  if (hidden.has(key)) {
    hidden.delete(key);
  } else {
    hidden.add(key);
  }
  savingMenu.value = true;
  try {
    await userStore.updateMenuSettings([...hidden]);
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    savingMenu.value = false;
  }
};

const apiTokenStore = useApiTokenStore();
const { tokens, newToken } = storeToRefs(apiTokenStore);

const newTokenName = ref('');
const isCreating = ref(false);
const copied = ref(false);

onMounted(() => {
  apiTokenStore.fetchTokens();
});

const handleCreateToken = async () => {
  if (!newTokenName.value.trim()) return;
  isCreating.value = true;
  try {
    await apiTokenStore.createToken(newTokenName.value.trim());
    newTokenName.value = '';
  } finally {
    isCreating.value = false;
  }
};

const copyToken = async () => {
  if (!newToken.value) return;
  await navigator.clipboard.writeText(newToken.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
};

const dismissNewToken = () => {
  apiTokenStore.clearNewToken();
};

const yandexLinkUrl = computed(() => `${config.public.API_URL}/api/auth/yandex?link=1`);
const yandexUnlinking = ref(false);

const unlinkYandex = async () => {
  yandexUnlinking.value = true;
  try {
    await authStore.unlinkYandex();
    $toast.success('Яндекс ID отвязан');
  } catch (e) {
    $toast.error(getErrorMessage(e));
  } finally {
    yandexUnlinking.value = false;
  }
};
</script>

<template>
  <div v-if="userInfo" class="base-profile-popup">
    <div class="base-profile-popup__back-mobile" @click.stop="emit('close')">
      <IconLongBack />
      <span>Профиль</span>
    </div>
    <div class="base-profile-popup__header">
      <div class="base-profile-popup__avatar" title="Изменить фото" @click="avatarCropper?.open()">
        <img v-if="userInfo.photo_url?.length" :src="userInfo.photo_url" alt="" />
        <span v-else>{{ useShortName(userInfo) }}</span>
        <div class="base-profile-popup__avatar-overlay">
          <IconCamera />
        </div>
      </div>
      <div class="base-profile-popup__info">
        <span class="base-profile-popup__role">{{ roleNames[userInfo.role] }}</span>
        <span class="base-profile-popup__name">{{ useFullName(userInfo) }}</span>
        <span class="base-profile-popup__email">{{ userInfo.email }}</span>
      </div>
    </div>

    <div class="base-profile-popup__actions">
      <button type="button" @click.stop="openUserEditModal">
        <IconPen />
        <span>Редактировать профиль</span>
      </button>
      <button type="button" class="base-profile-popup__actions-photo" @click.stop="avatarCropper?.open()">
        <span>Загрузить новое фото</span>
      </button>
    </div>

    <div class="base-profile-popup__section base-profile-popup__section_menu">
      <div class="base-profile-popup__section-title">Пункты меню</div>
      <label v-for="item in configurableMenuItems" :key="item.key" class="base-profile-popup__menu-toggle">
        <input
          type="checkbox"
          :checked="isMenuItemVisible(item.key)"
          :disabled="savingMenu"
          @change="toggleMenuItem(item.key)"
        />
        <span>{{ item.label }}</span>
      </label>
    </div>

    <div class="base-profile-popup__divider"></div>

    <div class="base-profile-popup__section">
      <div class="base-profile-popup__section-title">Вход через Яндекс</div>
      <div class="base-profile-popup__provider">
        <div class="base-profile-popup__provider-info">
          <span class="base-profile-popup__provider-icon" aria-hidden="true">Я</span>
          <span class="base-profile-popup__provider-name">
            {{ userInfo.yandex_linked ? 'Яндекс ID привязан' : 'Не привязан' }}
          </span>
        </div>
        <a
          v-if="!userInfo.yandex_linked"
          class="button_default base-profile-popup__provider-action base-profile-popup__provider-action_link"
          :href="yandexLinkUrl"
        >
          Привязать
        </a>
        <button
          v-else
          type="button"
          class="button_default base-profile-popup__provider-action base-profile-popup__provider-action_unlink"
          :disabled="yandexUnlinking"
          @click.stop="unlinkYandex"
        >
          {{ yandexUnlinking ? '...' : 'Отвязать' }}
        </button>
      </div>
      <p v-if="!userInfo.yandex_linked" class="base-profile-popup__provider-hint">
        Привяжите Яндекс, чтобы входить без пароля.
      </p>
    </div>

    <div class="base-profile-popup__divider"></div>

    <div class="base-profile-popup__section">
      <div class="base-profile-popup__section-title">API-токены</div>

      <div v-if="newToken" class="base-profile-popup__token-reveal">
        <span class="base-profile-popup__token-reveal-label">Сохраните токен — он больше не будет показан</span>
        <div class="base-profile-popup__token-reveal-row">
          <code class="base-profile-popup__token-value">{{ newToken }}</code>
          <button type="button" class="button_default base-profile-popup__token-copy" @click.stop="copyToken">
            <IconCopy />
            <span>{{ copied ? 'Скопировано' : 'Копировать' }}</span>
          </button>
        </div>
        <button type="button" class="button_default base-profile-popup__token-dismiss" @click.stop="dismissNewToken">
          Понятно
        </button>
      </div>

      <div v-if="tokens.length" class="base-profile-popup__tokens-list">
        <div v-for="token in tokens" :key="token.id" class="base-profile-popup__token-item">
          <div class="base-profile-popup__token-info">
            <span class="base-profile-popup__token-name">{{ token.name }}</span>
            <span class="base-profile-popup__token-meta">
              Создан {{ formatMessageDate(token.createdAt) }}
              <template v-if="token.last_used_at"> · Использован {{ formatMessageDate(token.last_used_at!) }}</template>
            </span>
          </div>
          <button
            type="button"
            class="button_default base-profile-popup__token-delete"
            @click.stop="apiTokenStore.deleteToken(token.id)"
          >
            <IconDeleteSimple />
          </button>
        </div>
      </div>

      <div class="base-profile-popup__token-create">
        <input
          v-model="newTokenName"
          class="base-profile-popup__token-input"
          type="text"
          placeholder="Название токена (например, CI/CD)"
          @keydown.enter.stop="handleCreateToken"
        />
        <button
          type="button"
          class="button_default base-profile-popup__token-add"
          :disabled="isCreating || !newTokenName.trim()"
          @click.stop="handleCreateToken"
        >
          {{ isCreating ? '...' : 'Создать' }}
        </button>
      </div>
    </div>

    <div class="base-profile-popup__divider base-profile-popup__divider_hidden-mob"></div>

    <button class="button_default base-profile-popup__logout" type="button" @click.stop="handleLogout">
      <IconLogout />
      <span>Выйти</span>
    </button>
    <BaseModal ref="userEditModal">
      <UserEditModal type="edit" :user="userInfo" profile-edit @close="closeUserEditModal" />
    </BaseModal>
    <AvatarCropperModal ref="avatarCropper" />
  </div>
</template>

<style scoped lang="scss">
.base-profile-popup {
  @include flex(cn);
  position: fixed;
  bottom: 66px;
  left: 92px;
  padding: 24px;
  border-radius: 8px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--dark-text-background-primary);
  box-shadow:
    0 16px 32px 0 var(--black-10),
    0 0 1px 0 var(--black-25);
  width: fit-content;
  min-width: 523px;
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  z-index: 20;

  @media (max-width: $screen-mobile-l) {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    min-width: unset;
    width: 100%;
    height: 100%;
    max-height: unset;
    padding: 0;
    border-radius: 0;
    border: none;
  }

  &__back-mobile {
    display: none;

    @media (max-width: $screen-mobile-l) {
      @include flex(rn, a-center);
      gap: 12px;
      padding: 28px 16px;
      border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    }

    span {
      @extend %text-l-medium;
    }
  }

  &__header {
    @include flex(rn);
    gap: 12px;

    @media (max-width: $screen-mobile-l) {
      padding: 24px 16px 0;
      flex-direction: column;
      align-items: center;
    }
  }

  &__avatar {
    @include flex(center);
    position: relative;
    width: 90px;
    height: 90px;
    aspect-ratio: 1 / 1;
    border-radius: 11px;
    overflow: hidden;
    cursor: pointer;
    background-color: var(--primary);
    font-family: 'Inter', sans-serif;
    font-size: 33.75px;
    font-style: normal;
    font-weight: 400;
    line-height: 45px;
    color: var(--light-text-backgroung-primary);

    @media (max-width: $screen-mobile-l) {
      width: 134px;
      height: 134px;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover &-overlay {
        opacity: 1;
      }
    }
  }

  &__avatar-overlay {
    position: absolute;
    inset: 0;
    @include flex(center);
    background: var(--black-50);
    opacity: 0;
    transition: opacity 0.2s ease;

    svg {
      width: 26px;
      height: 26px;
      color: var(--light-text-backgroung-primary);
    }
  }

  &__info {
    @include flex(cn, between);
    gap: 4px;

    @media (max-width: $screen-mobile-l) {
      align-items: center;
    }
  }

  &__role {
    @extend %text-s-medium;
    color: var(--primary);
  }

  &__name {
    @extend %display-s-bold;

    @media (max-width: $screen-mobile-l) {
      text-align: center;
    }
  }

  &__email {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary-50);
  }

  &__actions {
    margin-top: 16px;
    @include flex(rn, a-center);
    gap: 8px;

    @media (max-width: $screen-mobile-l) {
      padding: 0 16px;
      flex-direction: column;
      align-items: stretch;
    }

    button {
      flex: 1;

      @media (max-width: $screen-mobile-l) {
        padding: 10px 12px;
      }

      svg {
        width: 13px;
        height: 13px;
        stroke: var(--light-text-backgroung-primary);
        stroke-opacity: 1;
      }
    }
  }

  &__actions-photo {
    display: none;

    @media (max-width: $screen-mobile-l) {
      display: block;
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__divider {
    height: 1px;
    width: 100%;
    background-color: var(--light-text-backgroung-primary-10);
    margin: 28px 0;

    &_hidden-mob {
      @media (max-width: $screen-mobile-l) {
        display: none;
      }
    }
  }

  &__section {
    @include flex(cn);
    gap: 16px;

    @media (max-width: $screen-mobile-l) {
      padding: 0 16px;
    }
  }

  &__section-title {
    @extend %text-m-medium;
    color: var(--light-text-backgroung-primary);
  }

  &__section_menu {
    margin-top: 8px;
    padding-top: 20px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__menu-toggle {
    @include flex(rn, a-center);
    gap: 10px;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    input {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: var(--primary);
    }
  }

  &__provider {
    @include flex(rn, a-center, between);
  }

  &__provider-info {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__provider-icon {
    @include flex(center);
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #fc3f1d;
    color: #fff;
    font-weight: 800;
    font-size: 14px;
    line-height: 1;
  }

  &__provider-hint {
    margin: 0;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__provider-name {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__provider-action {
    flex-shrink: 0;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    text-decoration: none;
    @extend %text-s-medium;

    &_link {
      color: var(--light-text-backgroung-primary);
    }

    &_unlink {
      color: var(--danger-delete);
    }
  }

  &__logout {
    color: var(--danger-delete);

    @media (max-width: $screen-mobile-l) {
      margin: 24px 16px;
    }
  }

  &__tokens-list {
    @include flex(cn);
    gap: 8px;
  }

  &__token-item {
    @include flex(rn, a-center, between);
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--light-text-backgroung-primary-5);
  }

  &__token-info {
    @include flex(cn);
    gap: 2px;
    min-width: 0;
  }

  &__token-name {
    @extend %text-s-medium;
    color: var(--light-text-backgroung-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__token-meta {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__token-delete {
    flex-shrink: 0;
    opacity: 0.4;
    transition: opacity 0.15s ease;

    &:hover {
      opacity: 1;
    }

    svg {
      fill: var(--danger-delete);
    }
  }

  &__token-create {
    @include flex(rn, a-center);
    gap: 8px;
    margin-top: 4px;
  }

  &__token-input {
    flex: 1;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    background: transparent;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;
    outline: none;

    &::placeholder {
      color: var(--light-text-backgroung-primary-50);
    }

    &:focus {
      border-color: var(--primary);
    }
  }

  &__token-add {
    flex-shrink: 0;
    padding: 8px 14px;
    border-radius: 6px;
    background: var(--primary);
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
    transition: opacity 0.15s ease;

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__token-reveal {
    @include flex(cn);
    gap: 8px;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--primary);
    background: var(--light-text-backgroung-primary-5);
  }

  &__token-reveal-label {
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__token-reveal-row {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__token-value {
    flex: 1;
    @extend %text-s-regular;
    color: var(--primary);
    word-break: break-all;
    font-family: monospace;
  }

  &__token-copy {
    flex-shrink: 0;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-s-medium;

    svg {
      width: 12px;
      height: 12px;
    }
  }

  &__token-dismiss {
    align-self: flex-end;
    @extend %text-s-medium;
    color: var(--primary);
  }
}
</style>
