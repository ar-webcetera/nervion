<script setup lang="ts">
import { useRootStore } from '~/stores/rootStore';
import { PAGE_NAMES } from '~/constants/pages.constants';
import { ROLES } from '~/types/user';
import { useTaskStore } from '~/stores/taskStore';
import { useNotificationStore } from '~/stores/notificationStore';
import { useChatStore } from '~/stores/chatStore';
import { useMailStore } from '~/stores/mailStore';
import BaseTopTracker from '~/components/BaseTopTracker.vue';
import { computed } from 'vue';

defineProps<{
  isHiddenMenu?: boolean;
}>();

const rootStore = useRootStore();
const userStore = useUserStore();
const notificationStore = useNotificationStore();
const taskStore = useTaskStore();
const chatStore = useChatStore();

const chatId = computed(() => route.query?.chatId);
const mailDetailOpen = computed(
  () => route.name === 'mail' && Boolean(route.query?.thread || route.query?.compose),
);
const hideChrome = computed(
  () => Boolean(chatId.value) || mailDetailOpen.value || rootStore.isDetailFullscreen,
);

const isMenuVisible = (key: string) => !(userStore.user?.hidden_menu_items ?? []).includes(key);

const mailStore = useMailStore();

const totalUnreadCount = computed(() => {
  return chatStore.chatList.filter((chat) => chat.unreadMessagesCount > 0).length;
});
const mailInboxUnreadCount = computed(() => Number(mailStore.inboxUnreadCount) || 0);
const router = useRouter();
const route = useRoute();
const { $toast } = useNuxtApp();

const { openPopup, closePopup, isPopupOpen } = useProfile();

let mailUnreadTimer: ReturnType<typeof setInterval> | null = null;

const refreshMailUnread = () => {
  void mailStore.fetchUnreadCount().catch(() => {});
};

const handleMailPageShow = () => {
  refreshMailUnread();
};

const navScrollRef = ref<HTMLElement | null>(null);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const isNavOverflowing = ref(false);

const updateNavScroll = () => {
  const el = navScrollRef.value;
  if (!el) return;
  isNavOverflowing.value = el.scrollHeight > el.clientHeight + 4;
  canScrollUp.value = el.scrollTop > 4;
  canScrollDown.value = Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight - 4;
};

onMounted(() => {
  refreshMailUnread();
  mailUnreadTimer = setInterval(refreshMailUnread, 120000);
  window.addEventListener('pageshow', handleMailPageShow);
  void nextTick(updateNavScroll);
  window.addEventListener('resize', updateNavScroll);
});

onUnmounted(() => {
  if (mailUnreadTimer) clearInterval(mailUnreadTimer);
  window.removeEventListener('pageshow', handleMailPageShow);
  window.removeEventListener('resize', updateNavScroll);
});

const goToLink = (currentTaskId: number, link: string) => {
  taskStore.currentTaskId = currentTaskId;
  router.push(link);
};

const markAllAsRead = async () => {
  try {
    await notificationStore.markAllAsRead();
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};

const updateNotification = async (notificationId: number, { is_read }: { is_read: boolean }) => {
  try {
    await notificationStore.updateNotifications(notificationId, { is_read });
  } catch (e) {
    $toast.error(getErrorMessage(e));
  }
};
</script>

<template>
  <div :class="['base-menu-left', { 'base-menu-left_hide': rootStore.isHideSideBar, 'base-menu-left_chat-opened': hideChrome }]">
    <div class="base-menu-left__header">
      <NuxtLink class="base-menu-left__logo" :to="{ name: PAGE_NAMES.home }">
        <IconsIconLogo />
      </NuxtLink>
      <BaseNotification
        :notifications="notificationStore.notifications"
        @go-to-link="goToLink"
        @mark-all-as-read="markAllAsRead"
        @update-notifications="updateNotification"
      />
      <BaseTopTracker />
    </div>
    <div class="base-menu-left__nav">
      <div
        v-show="canScrollUp"
        class="base-menu-left__nav-fade base-menu-left__nav-fade_top"
        aria-hidden="true"
      ></div>
      <div
        ref="navScrollRef"
        class="base-menu-left__nav-scroll"
        :class="{ 'base-menu-left__nav-scroll_scrollable': isNavOverflowing }"
        @scroll="updateNavScroll"
      >
      <div class="base-menu-left__items">
        <NuxtLink
          :to="{ name: PAGE_NAMES.home }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
          :data-tooltip="'Задачи'"
        >
          <IconsIconAllTasks />
        </NuxtLink>
        <NuxtLink
          v-if="isMenuVisible('projects')"
          :data-tooltip="'Проекты'"
          :to="{ name: PAGE_NAMES.projects }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <IconsIconProjects />
        </NuxtLink>

        <NuxtLink
          v-if="isMenuVisible('wiki')"
          :data-tooltip="'Вики'"
          :to="{ name: PAGE_NAMES.wiki }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M4.5 0.5H3.7002C2.58009 0.5 2.01962 0.5 1.5918 0.717987C1.21547 0.909734 0.909734 1.21547 0.717987 1.5918C0.5 2.01962 0.5 2.58009 0.5 3.7002V13.3002C0.5 14.4203 0.5 14.9801 0.717987 15.4079C0.909734 15.7842 1.21547 16.0905 1.5918 16.2822C2.0192 16.5 2.57899 16.5 3.69691 16.5H4.5M4.5 0.5H13.3002C14.4203 0.5 14.9796 0.5 15.4074 0.717987C15.7837 0.909734 16.0905 1.21547 16.2822 1.5918C16.5 2.0192 16.5 2.57899 16.5 3.69691V13.3036C16.5 14.4215 16.5 14.9805 16.2822 15.4079C16.0905 15.7842 15.7837 16.0905 15.4074 16.2822C14.98 16.5 14.421 16.5 13.3031 16.5H4.5M4.5 0.5V16.5M8.5 7.5H12.5M8.5 4.5H12.5"
              stroke="#FEFEFE"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="isMenuVisible('chat')"
          :data-tooltip="'Чаты'"
          :to="{ name: PAGE_NAMES.CHAT }"
          class="base-menu-left__item chat-icon-wrapper"
          active-class="base-menu-left__item_active"
        >
          <div v-if="totalUnreadCount > 0" class="chat-unread-badge">{{ totalUnreadCount }}</div>
          <IconsIconChat />
        </NuxtLink>
        <NuxtLink
          v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('mail')"
          :data-tooltip="'Почта'"
          :to="{ name: PAGE_NAMES.MAIL }"
          class="base-menu-left__item chat-icon-wrapper"
          active-class="base-menu-left__item_active"
        >
          <div v-if="mailInboxUnreadCount > 0" class="chat-unread-badge">{{ mailInboxUnreadCount }}</div>
          <svg width="24" height="24" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="2.5" width="16" height="12" rx="1.5" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M1.5 4L8.5 9L15.5 4" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('planning')"
          :data-tooltip="'Планирование'"
          :to="{ name: PAGE_NAMES.planning }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <IconsIconCalendarMenu />
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role !== ROLES.guest && isMenuVisible('schedule')"
          :data-tooltip="'График работы'"
          :to="{ name: PAGE_NAMES.SCHEDULE }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="0.5" width="7" height="7" rx="1.5" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="9.5" y="0.5" width="7" height="7" rx="1.5" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="0.5" y="9.5" width="7" height="7" rx="1.5" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="9.5" y="9.5" width="7" height="7" rx="1.5" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </NuxtLink>
      </div>
      <div class="base-menu-left__items">
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('report')"
          :data-tooltip="'Отчеты'"
          :to="{ name: PAGE_NAMES.report }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <IconsIconReports />
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('users-management')"
          :data-tooltip="'Управление пользователями'"
          :to="{ name: PAGE_NAMES.USERS_MANAGEMENT }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <IconsIconUsers />
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('changelogs')"
          :data-tooltip="'Changelog'"
          :to="{ name: PAGE_NAMES.CHANGELOGS }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <IconsIconChangelog />
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('audit-logs')"
          :data-tooltip="'Журнал действий'"
          :to="{ name: PAGE_NAMES.AUDIT_LOGS }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 16 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="0.5" width="3" height="3" rx="0.75" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 2H15.5" stroke="#FEFEFE" stroke-linecap="round"/>
            <rect x="0.5" y="6" width="3" height="3" rx="0.75" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 7.5H15.5" stroke="#FEFEFE" stroke-linecap="round"/>
            <rect x="0.5" y="11.5" width="3" height="3" rx="0.75" stroke="#FEFEFE" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 13H12.5" stroke="#FEFEFE" stroke-linecap="round"/>
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('healthchecks')"
          :data-tooltip="'Healthcheck-мониторы'"
          :to="{ name: PAGE_NAMES.HEALTHCHECKS }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M11.5 15.5H5.5M0.5 9.3002V3.7002C0.5 2.58009 0.5 2.01962 0.717987 1.5918C0.909734 1.21547 1.21547 0.909734 1.5918 0.717987C2.01962 0.5 2.58009 0.5 3.7002 0.5H13.3002C14.4203 0.5 14.9796 0.5 15.4074 0.717987C15.7837 0.909734 16.0905 1.21547 16.2822 1.5918C16.5 2.0192 16.5 2.57899 16.5 3.69691V9.30309C16.5 10.421 16.5 10.98 16.2822 11.4074C16.0905 11.7837 15.7837 12.0905 15.4074 12.2822C14.98 12.5 14.421 12.5 13.3031 12.5H3.69691C2.57899 12.5 2.0192 12.5 1.5918 12.2822C1.21547 12.0905 0.909734 11.7837 0.717987 11.4074C0.5 10.9796 0.5 10.4203 0.5 9.3002Z"
              stroke="#FEFEFE"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('mail-accounts')"
          :data-tooltip="'Почтовые ящики'"
          :to="{ name: PAGE_NAMES.MAIL_ACCOUNTS }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.75" y="3.25" width="14.5" height="9.5" rx="1.5" stroke="#FEFEFE" />
            <path d="M1.5 4.5L8 8.5L14.5 4.5" stroke="#FEFEFE" stroke-linecap="round" />
            <circle cx="12.6" cy="11" r="2.4" fill="var(--dark-text-background-primary)" stroke="#FEFEFE" />
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="userStore.user?.role === ROLES.admin && isMenuVisible('git')"
          :data-tooltip="'Git'"
          :to="{ name: PAGE_NAMES.GIT }"
          class="base-menu-left__item"
          active-class="base-menu-left__item_active"
        >
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="4" cy="3" r="2" stroke="#FEFEFE" stroke-width="1.2" />
            <circle cx="4" cy="13" r="2" stroke="#FEFEFE" stroke-width="1.2" />
            <circle cx="12" cy="6" r="2" stroke="#FEFEFE" stroke-width="1.2" />
            <path d="M4 5V11" stroke="#FEFEFE" stroke-width="1.2" stroke-linecap="round" />
            <path d="M12 8C12 10 10 11 7 11" stroke="#FEFEFE" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </NuxtLink>
      </div>
      </div>
      <div
        v-show="canScrollDown"
        class="base-menu-left__nav-fade base-menu-left__nav-fade_bottom"
        aria-hidden="true"
      >
        <span class="base-menu-left__nav-chevron">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </div>
    </div>
    <div class="base-menu-left__bottom">
      <div :data-tooltip="'Управление пользователями'" class="base-menu-left__profile">
        <img
          v-if="userStore.user?.photo_url?.length"
          :src="userStore.user?.photo_url"
          alt=""
          @click.stop="openPopup()"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <span v-else-if="userStore.user" @click.stop="openPopup()">{{ useShortName(userStore.user) }}</span>
      </div>
      <div v-if="isPopupOpen" v-click-outside="closePopup">
        <BaseProfilePopup @close="closePopup" />
      </div>
    </div>
    <div v-if="!hideChrome && !isHiddenMenu" class="base-menu-left__mobile-menu">
      <NuxtLink
        :to="{ name: PAGE_NAMES.home }"
        class="base-menu-left__item base-menu-left__item_mob"
        active-class="base-menu-left__item_active base-menu-left__item_mob-active"
        :data-tooltip="'Задачи'"
      >
        <IconsIconAllTasks />
        <span>Задачи</span>
      </NuxtLink>
      <NuxtLink
        :data-tooltip="'Чаты'"
        :to="{ name: PAGE_NAMES.CHAT }"
        class="base-menu-left__item base-menu-left__item_mob chat-icon-wrapper"
        active-class="base-menu-left__item_active base-menu-left__item_mob-active"
      >
        <div v-if="totalUnreadCount > 0" class="chat-unread-badge">{{ totalUnreadCount }}</div>
        <IconsIconChat />
        <span>Чаты</span>
      </NuxtLink>
      <NuxtLink
        v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('mail')"
        :data-tooltip="'Почта'"
        :to="{ name: PAGE_NAMES.MAIL }"
        class="base-menu-left__item base-menu-left__item_mob chat-icon-wrapper"
        active-class="base-menu-left__item_active base-menu-left__item_mob-active"
      >
        <div v-if="mailInboxUnreadCount > 0" class="chat-unread-badge">{{ mailInboxUnreadCount }}</div>
        <svg width="24" height="24" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="0.5" y="2.5" width="16" height="12" rx="1.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M1.5 4L8.5 9L15.5 4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>Почта</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-icon-wrapper {
  position: relative;
}

.chat-unread-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background-color: var(--primary);
  border-radius: 50%;
  min-width: 16px;
  height: 16px;
  @include flex(center);
  @extend %text-xs-light;
  color: var(--light-text-backgroung-primary);
}

.base-menu-left {
  height: 100%;
  width: 100%;
  max-width: 80px;
  padding: 20px;
  @include flex(cn);
  gap: 24px;
  background-color: var(--dark-text-background-primary);
  transition: all 0.2s ease;
  border-right: 1px solid var(--light-text-backgroung-primary-10);
  z-index: 999;

  @media (max-width: $screen-mobile-l) {
    flex-direction: row;
    max-width: unset;
    height: 80px;
    padding: 16px 10.5px 10px;
  }

  &__bottom {
    margin-top: auto;

    @media (max-width: $screen-mobile-l) {
      margin-top: unset;
      margin-left: auto;
    }
  }

  &__profile {
    cursor: pointer;
    position: relative;
    @include flex(center);
    height: 40px;
    width: 40px;
    overflow: hidden;
    transition: width 0.2s ease;
    background: var(--primary);
    border-radius: 50%;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-regular;

    @media (max-width: $screen-mobile-l) {
      width: 54px;
      height: 54px;
    }

    span {
      width: 100%;
      height: 100%;
      @include flex(center);
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &_hide {
    justify-content: space-between;
    width: auto;

    .base-menu-left__item {
      justify-content: center;

      span {
        display: none;
      }

      svg {
        &:last-child {
          display: none;
        }
      }
    }

    .base-menu-left__back {
      span {
        display: none;
      }
    }

    .base-menu-left__icon-window {
      margin: 0 auto;

      &_indent {
        margin-top: auto;
      }
    }
  }

  &_chat-opened {
    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__nav {
    position: relative;
    flex: 1;
    min-height: 0;
    @include flex(cn);

    @media (max-width: $screen-mobile-l) {
      flex: unset;
      min-height: unset;
    }
  }

  &__nav-scroll {
    @include flex(cn);
    gap: 32px;
    height: 100%;

    &_scrollable {
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    @media (max-width: $screen-mobile-l) {
      height: auto;
      overflow: visible;
    }
  }

  &__nav-fade {
    position: absolute;
    left: 0;
    right: 0;
    height: 44px;
    pointer-events: none;
    z-index: 1;

    @media (max-width: $screen-mobile-l) {
      display: none;
    }

    &_top {
      top: 0;
      background: linear-gradient(to bottom, var(--dark-text-background-primary) 25%, transparent);
    }

    &_bottom {
      bottom: 0;
      @include flex(cn, center);
      justify-content: flex-end;
      padding-bottom: 2px;
      background: linear-gradient(to top, var(--dark-text-background-primary) 35%, transparent);
    }
  }

  &__nav-chevron {
    color: var(--light-text-backgroung-primary-50);
    @include flex(center);
    animation: base-menu-scroll-hint 1.4s ease-in-out infinite;
  }

  &__header {
    @include flex(cn, center);
    gap: 12px;
    flex-shrink: 0;

    @media (max-width: $screen-mobile-l) {
      flex-direction: row;
    }

    div {
      cursor: pointer;
      position: relative;
      @include flex(center);
      height: 40px;
      width: 40px;
      @include flex(rn, a-center);
      color: var(--white-50);
      transition: width 0.2s ease;

      @media (max-width: $screen-mobile-l) {
        width: 54px;
        height: 54px;
        background-color: var(--light-text-backgroung-primary-5);
        border-radius: 8px;
      }
    }
  }

  &__logo {
    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__back {
    @include flex(rn, a-end);
    gap: 12px;

    svg {
      transform: rotate(180deg);
    }

    span {
      @extend %p14-bold;
    }
  }

  &__icon-window {
    cursor: pointer;
    transition: all 0.2s ease;

    &_show {
      display: block;
    }

    &:hover {
      fill: var(--white-100);
    }
  }

  &__items {
    gap: 12px;
    @include flex(cn, a-center);

    @media (max-width: $screen-mobile-l) {
      display: none;
    }
  }

  &__item {
    cursor: pointer;
    position: relative;
    @include flex(center);
    height: 40px;
    width: 40px;
    @include flex(rn, a-center);
    color: var(--white-50);
    transition: width 0.2s ease;

    border-radius: 8px;
    svg {
      width: 18px;
      height: 18px;
      stroke: var(--light-text-backgroung-primary-50);
      stroke-opacity: 0.5;
    }

    &_active {
      background-color: var(--light-text-backgroung-primary-10);
      color: var(--white-100);
      svg {
        stroke: var(--light-text-backgroung-primary);
        stroke-opacity: 1;
      }
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        background-color: var(--light-text-backgroung-primary-5);
        color: var(--white-100);
        svg {
          stroke: var(--light-text-backgroung-primary-50);
        }
      }
    }

    &_mob {
      width: fit-content;
      height: auto;
      padding: 12px 24px;
      gap: 4px;
      transition: all 0.2s ease;

      svg {
        stroke-opacity: 1;
      }

      span {
        @include text-s-regular;
        display: none;
      }
    }

    &_mob-active {
      span {
        display: block;
      }
    }
  }

  &__mobile-menu {
    display: none;

    @media (max-width: $screen-mobile-l) {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      padding: 10px 16px;
      padding-bottom: calc(10px + env(safe-area-inset-bottom));
      @include flex(rn, around);
      gap: 12px;
      border-radius: 0;
      border: none;
      background: var(--dark-text-background-primary);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 -8px 24px rgba(0, 0, 0, 0.45);
      transition: all 0.2s ease;
    }
  }
}

@keyframes base-menu-scroll-hint {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(3px);
  }
}
</style>
