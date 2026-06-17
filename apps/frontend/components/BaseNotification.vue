<script setup lang="ts">
import IconClose from '~/components/Icons/IconClose.vue';
import IconConfirm from '~/components/Icons/IconConfirm.vue';
import type { Notification } from '~/types/notification';
import { format } from 'date-fns';
import IconLongBack from './Icons/IconLongBack.vue';

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
    <div class="notification__icon" @click="isOpenNotificationMenu = true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M15 17V18C15 19.6569 13.6569 21 12 21C10.3431 21 9 19.6569 9 18V17M15 17H9M15 17H18.5905C18.973 17 19.1652 17 19.3201 16.9478C19.616 16.848 19.8475 16.6156 19.9473 16.3198C19.9997 16.1643 19.9997 15.9715 19.9997 15.5859C19.9997 15.4172 19.9995 15.3329 19.9863 15.2524C19.9614 15.1004 19.9024 14.9563 19.8126 14.8312C19.7651 14.7651 19.7048 14.7048 19.5858 14.5858L19.1963 14.1963C19.0706 14.0706 19 13.9001 19 13.7224V10C19 6.134 15.866 2.99999 12 3C8.13401 3.00001 5 6.13401 5 10V13.7224C5 13.9002 4.92924 14.0706 4.80357 14.1963L4.41406 14.5858C4.29476 14.7051 4.23504 14.765 4.1875 14.8312C4.09766 14.9564 4.03815 15.1004 4.0132 15.2524C4 15.3329 4 15.4172 4 15.586C4 15.9715 4 16.1642 4.05245 16.3197C4.15225 16.6156 4.3848 16.848 4.68066 16.9478C4.83556 17 5.02701 17 5.40956 17H9"
          stroke="#FEFEFE"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-if="isExistNotReadMessage" class="notification__icon_dot"></span>
    </div>

    <div v-if="isOpenNotificationMenu" class="notification__menu">
      <div v-if="isOpenNotificationMenu" class="notification__menu-header" @click.stop="isOpenNotificationMenu = false">
        <p><IconLongBack />Уведомления</p>
        <span>
          <IconClose />
        </span>
      </div>
      <div class="notification__items-wrapper">
        <div class="notification__items">
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
      </div>
      <div class="notification__read-all-button-wrapper">
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
      svg {
        stroke-opacity: 1;
      }
    }
  }

  &__icon {
    @include flex(center);
    position: relative;
    stroke-opacity: 0.5;

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

      // на мобилке боковые отступы списка = шапке (16px)
      @media (max-width: $screen-mobile-l) {
        padding: 12px 16px;
      }
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

    @media (max-width: $screen-mobile-l) {
      padding: 28px 16px;
    }

    p {
      @extend %text-l-medium;
      color: var(--light-text-backgroung-primary);

      svg {
        display: none;

        @media (max-width: $screen-mobile-l) {
          display: block;
        }
      }

      @media (max-width: $screen-mobile-l) {
        @include flex(rn, center);
        gap: 12px;
      }
    }

    span {
      svg {
        width: 18px;
        height: 18px;
      }

      @media (max-width: $screen-mobile-l) {
        display: none;
      }
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
      height: 100%;
      min-width: unset;
      border-radius: 0;
      border: none;
    }
  }
}
</style>
