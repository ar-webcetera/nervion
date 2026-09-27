<script setup lang="ts">
import { Bell, BellOff, X } from '@lucide/vue';
import IconConfirm from '~/components/Icons/IconConfirm.vue';
import type { Notification } from '~/types/notification';
import { format } from 'date-fns';

const { $toast } = useNuxtApp();

const isOpenNotificationMenu = ref(false);

const emit = defineEmits(['mark-all-as-read', 'update-notifications', 'go-to-link']);

const props = defineProps({
  notifications: {
    type: Array as PropType<Notification[]>,
    default: () => [
      {
        id: 1,
        name: 'Название уведомления',
        message: 'Текст сообщения',
        link: '/',
        recipient_id: 1,
        recipient: {
          id: 1,
        },
        is_read: false,
        created_at: new Date(),
      },
    ],
  },
});

const updateNotification = async (notificationId: number, { is_read }: { is_read: boolean }) => {
  try {
    emit('update-notifications', notificationId, { is_read });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const isExistNotReadMessage = computed(() => {
  if (!props.notifications?.length) return null;
  return props.notifications.some((n) => !n.is_read);
});

const getTaskIdFromUrl = (url: string): string | null => {
  const params = new URLSearchParams(url.split('?')[1] || '');
  return params.get('task-id');
};

const goToLink = (notificationId: number, link: string) => {
  updateNotification(notificationId, { is_read: true });
  const currentTaskId = Number(getTaskIdFromUrl(link));
  emit('go-to-link', currentTaskId, link);
};

const originalTitle = ref('');
const updateBadge = (hasUnread: boolean) => {
  if (hasUnread) {
    document.title = `● ${originalTitle.value}`;
  } else {
    document.title = originalTitle.value;
  }
};

const isAllRead = computed(() => {
  return props.notifications.some((n: Notification) => !n.is_read);
});

const markAllAsRead = async () => {
  if (!isAllRead.value) return;
  emit('mark-all-as-read');
  props.notifications.forEach((notification: Notification) => {
    if (!notification.is_read) notification.is_read = true;
  });
};

const handleClickOutside = () => {
  isOpenNotificationMenu.value = false;
};

watch(() => props.notifications?.some((n) => !n.is_read), updateBadge, { immediate: false });

onMounted(() => {
  originalTitle.value = document.title;
});
</script>

<template>
  <div v-click-outside="handleClickOutside" :class="['notification', { notification_active: isOpenNotificationMenu }]">
    <button
      type="button"
      class="notification__icon"
      aria-label="Уведомления"
      title="Уведомления"
      :aria-expanded="isOpenNotificationMenu"
      @click="isOpenNotificationMenu = !isOpenNotificationMenu"
    >
      <Bell :size="20" :stroke-width="1.75" aria-hidden="true" />
      <span v-if="isExistNotReadMessage" class="notification__icon_dot"></span>
    </button>

    <div v-if="isOpenNotificationMenu" class="notification__menu">
      <div class="notification__menu-header">
        <h2>Уведомления</h2>
        <button
          type="button"
          class="notification__menu-close"
          aria-label="Закрыть уведомления"
          title="Закрыть"
          @click.stop="isOpenNotificationMenu = false"
        >
          <X :size="20" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </div>
      <div class="notification__items-wrapper">
        <div v-if="notifications.length" class="notification__items">
          <div
            v-for="notification of notifications"
            :key="notification.id"
            class="notification__item"
            :class="{ notification__item_inactive: notification.is_read }"
          >
            <div class="notification__item-info" @click="goToLink(notification.id, notification.link)">
              <span>{{ format(notification.created_at, 'yyyy-MM-dd HH:mm:ss') }}</span>
              <a>
                <div class="notification__name">{{ notification.name }}:</div>
              </a>
              <div class="notification__message">
                <div>{{ notification.message }}</div>
              </div>
            </div>
            <div
              class="notification__read-button"
              @click="updateNotification(notification.id, { is_read: !notification.is_read })"
            >
              <IconConfirm />
            </div>
          </div>
        </div>
        <div v-else class="notification__empty" role="status">
          <BellOff :size="28" :stroke-width="1.75" aria-hidden="true" />
          <strong>Уведомлений пока нет</strong>
          <p>Здесь появятся новые события по задачам и проектам.</p>
        </div>
      </div>
      <div v-if="notifications.length" class="notification__read-all-button-wrapper">
        <div
          :class="['notification__read-all-button', { 'notification__read-all-button_disabled': !isAllRead }]"
          @click="markAllAsRead"
        >
          {{ !isAllRead ? 'Все прочитано' : 'Прочитать все' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.notification {
  @include flex(a-center);
  position: relative;

  &_active {
    background-color: var(--light-text-backgroung-primary-10);
    border-radius: 8px;

    .notification__icon {
      color: var(--light-text-backgroung-primary);
    }
  }

  &__icon {
    @include flex(center);
    position: relative;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-5);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    &:active {
      background: var(--light-text-backgroung-primary-25);
    }

    &_dot {
      top: 2px;
      right: 2px;
      position: absolute;
      background: var(--danger-delete);
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
  }

  &__read-button {
    cursor: pointer;
    border-radius: 8px;
    background: var(--white-10);
    @include flex(center);
    width: 32px;
    height: 32px;
    padding: 6px;
  }

  &__read-all-button-wrapper {
    padding: 16px 24px;
  }

  &__read-all-button {
    padding: 10px 12px;
    @include flex(center);
    border-radius: 8px;
    background: var(--primary);
    @extend %text-s-regular;
    width: 100%;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);

    &_disabled {
      border: 1px solid var(--light-text-backgroung-primary-10);
      background: var(--light-text-backgroung-primary-5);
      cursor: default;
      color: var(--light-text-backgroung-primary-25);
    }
  }

  svg {
    cursor: pointer;
  }

  &__date {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__item-info {
    display: flex;
    flex-direction: column;
    gap: 4px;

    span {
      @extend %text-xs-regular;
      color: var(--light-text-backgroung-primary-50);
    }

    a {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary);
    }

    & > div {
      @extend %text-s-regular;
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__items {
    height: max-content;
    @include flex(cn);
    gap: 8px;

    &-wrapper {
      overflow: auto;
      height: 100%;
      width: 100%;
      padding: 12px 24px;

      @media (max-width: $screen-mobile-l) {
        padding: 12px 16px;
      }
    }
  }

  &__empty {
    width: 100%;
    height: 100%;
    max-width: 280px;
    margin: auto;
    padding: 24px 0;
    color: var(--light-text-backgroung-primary-50);
    text-align: center;
    @include flex(cn, center);
    gap: 8px;

    svg {
      margin-bottom: 4px;
      color: var(--light-text-backgroung-primary-25);
      cursor: default;
    }

    strong {
      color: var(--light-text-backgroung-primary);
      @extend %text-s-medium;
    }

    p {
      margin: 0;
      @extend %text-xs-regular;
    }
  }

  &__item {
    word-wrap: anywhere;
    width: 100%;
    @include flex(a-start, between);
    padding: 8px;
    gap: 4px;
    align-self: stretch;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    transition: background-color 0.2s ease;
    cursor: pointer;

    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }

    &_inactive {
      opacity: 0.3;
    }
  }

  &__menu-header {
    width: 100%;
    @include flex(a-center, between);
    gap: 24px;
    padding: 16px 24px 8px 24px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);

    h2 {
      margin: 0;
      @extend %text-l-medium;
      color: var(--light-text-backgroung-primary);
    }

    @media (max-width: $screen-mobile-l) {
      min-height: 72px;
      padding: max(14px, env(safe-area-inset-top)) 12px 14px 16px;
    }
  }

  &__menu-close {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @include flex(center);

    &:hover,
    &:focus-visible {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__menu {
    z-index: 1000;
    min-width: 500px;
    height: 80dvh;
    top: 0;
    left: calc(100% + 24px);
    position: absolute;
    @include flex(cn);
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-5);
    background: var(--dark-text-background-primary);
    overflow-y: hidden;

    @media (max-width: $screen-mobile-l) {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100dvh;
      min-width: unset;
      border-radius: 0;
      border: none;
    }
  }
}
</style>
