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
import {
  ListTodo,
  FolderKanban,
  Funnel,
  BookOpen,
  MessagesSquare,
  Mail,
  CalendarDays,
  CalendarClock,
  ChartNoAxesCombined,
  Users,
  ScrollText,
  ListChecks,
  MonitorCheck,
  Mailbox,
  GitBranch,
  ChevronDown,
} from '@lucide/vue';

const navigationIconProps = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;
const mainNavigationIconProps = { size: 19, strokeWidth: 1.75, 'aria-hidden': true } as const;

defineProps<{
  isHiddenMenu?: boolean;
}>();

const rootStore = useRootStore();
const userStore = useUserStore();
const notificationStore = useNotificationStore();
const taskStore = useTaskStore();
const chatStore = useChatStore();
const reportStore = useReportStore();

const chatId = computed(() => route.query?.chatId);
const mailDetailState = useState<boolean | null>('mail-detail-open', () => null);
const mailDetailOpen = computed(
  () => route.name === 'mail' && (mailDetailState.value ?? Boolean(route.query?.thread || route.query?.compose)),
);
const hideChrome = computed(() => Boolean(chatId.value) || mailDetailOpen.value || rootStore.isDetailFullscreen);

const isMenuVisible = (key: string) => !(userStore.user?.hidden_menu_items ?? []).includes(key);

const mailStore = useMailStore();
const selectedMailAccountId = useState<number>('mail-selected-account-id', () => 0);

const totalUnreadCount = computed(() => {
  return chatStore.chatList.filter((chat) => chat.unreadMessagesCount > 0).length;
});
const mailInboxUnreadCount = computed(() => Number(mailStore.accountUnreadCounts[selectedMailAccountId.value]?.inbox) || 0);
const router = useRouter();
const route = useRoute();
const isCrmRoute = computed(() => route.path === '/crm' || route.path.startsWith('/crm/'));
const { $toast } = useNuxtApp();

const { openPopup, closePopup, isPopupOpen } = useProfile();

let mailUnreadTimer: ReturnType<typeof setInterval> | null = null;

const refreshMailUnread = () => {
  if (!selectedMailAccountId.value) return;
  void mailStore.fetchAccountUnreadCount(selectedMailAccountId.value).catch(() => {});
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
  if (userStore.user?.role === ROLES.admin) void reportStore.fetchPendingCount().catch(() => {});
});

onUnmounted(() => {
  if (mailUnreadTimer) clearInterval(mailUnreadTimer);
  window.removeEventListener('pageshow', handleMailPageShow);
  window.removeEventListener('resize', updateNavScroll);
});

const goToLink = (currentTaskId: number, link: string) => {
  if (currentTaskId > 0) taskStore.currentTaskId = currentTaskId;
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
      <div v-show="canScrollUp" class="base-menu-left__nav-fade base-menu-left__nav-fade_top" aria-hidden="true"></div>
      <div
        ref="navScrollRef"
        class="base-menu-left__nav-scroll"
        :class="{ 'base-menu-left__nav-scroll_scrollable': isNavOverflowing }"
        @scroll="updateNavScroll"
      >
        <div class="base-menu-left__items">
          <NuxtLink
            aria-label="Задачи"
            :to="{ name: PAGE_NAMES.home }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
            :data-tooltip="'Задачи'"
          >
            <ListTodo v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('crm')"
            to="/crm/deals"
            class="base-menu-left__item"
            :class="{ 'base-menu-left__item_active': isCrmRoute }"
            :aria-current="isCrmRoute ? 'page' : undefined"
            data-tooltip="CRM"
            aria-label="CRM"
          >
            <Funnel v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="isMenuVisible('projects')"
            aria-label="Проекты"
            :data-tooltip="'Проекты'"
            :to="{ name: PAGE_NAMES.projects }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <FolderKanban v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="isMenuVisible('wiki')"
            aria-label="Вики"
            :data-tooltip="'Вики'"
            :to="{ name: PAGE_NAMES.wiki }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <BookOpen v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="isMenuVisible('chat')"
            aria-label="Чаты"
            :data-tooltip="'Чаты'"
            :to="{ name: PAGE_NAMES.CHAT }"
            class="base-menu-left__item chat-icon-wrapper"
            active-class="base-menu-left__item_active"
          >
            <div v-if="totalUnreadCount > 0" class="chat-unread-badge">{{ totalUnreadCount }}</div>
            <MessagesSquare v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('mail')"
            aria-label="Почта"
            :data-tooltip="'Почта'"
            :to="{ name: PAGE_NAMES.MAIL }"
            class="base-menu-left__item chat-icon-wrapper"
            active-class="base-menu-left__item_active"
          >
            <div v-if="mailInboxUnreadCount > 0" class="chat-unread-badge">{{ mailInboxUnreadCount }}</div>
            <Mail v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('planning')"
            aria-label="Планирование"
            :data-tooltip="'Планирование'"
            :to="{ name: PAGE_NAMES.planning }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <CalendarDays v-bind="mainNavigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role !== ROLES.guest && isMenuVisible('schedule')"
            aria-label="График работы"
            :data-tooltip="'График работы'"
            :to="{ name: PAGE_NAMES.SCHEDULE }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <CalendarClock v-bind="mainNavigationIconProps" />
          </NuxtLink>
        </div>
        <div class="base-menu-left__items">
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('report')"
            aria-label="Отчеты"
            :data-tooltip="'Отчеты'"
            :to="{ name: PAGE_NAMES.report }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <div v-if="reportStore.pendingCount > 0" class="chat-unread-badge">{{ reportStore.pendingCount }}</div>
            <ChartNoAxesCombined v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('users-management')"
            aria-label="Управление пользователями"
            :data-tooltip="'Управление пользователями'"
            :to="{ name: PAGE_NAMES.USERS_MANAGEMENT }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <Users v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('changelogs')"
            aria-label="Changelog"
            :data-tooltip="'Changelog'"
            :to="{ name: PAGE_NAMES.CHANGELOGS }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <ScrollText v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('audit-logs')"
            aria-label="Журнал действий"
            :data-tooltip="'Журнал действий'"
            :to="{ name: PAGE_NAMES.AUDIT_LOGS }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <ListChecks v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('healthchecks')"
            aria-label="Healthcheck-мониторы"
            :data-tooltip="'Healthcheck-мониторы'"
            :to="{ name: PAGE_NAMES.HEALTHCHECKS }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <MonitorCheck v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('mail-accounts')"
            aria-label="Почтовые ящики"
            :data-tooltip="'Почтовые ящики'"
            :to="{ name: PAGE_NAMES.MAIL_ACCOUNTS }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <Mailbox v-bind="navigationIconProps" />
          </NuxtLink>
          <NuxtLink
            v-if="userStore.user?.role === ROLES.admin && isMenuVisible('git')"
            aria-label="Git"
            :data-tooltip="'Git'"
            :to="{ name: PAGE_NAMES.GIT }"
            class="base-menu-left__item"
            active-class="base-menu-left__item_active"
          >
            <GitBranch v-bind="navigationIconProps" />
          </NuxtLink>
        </div>
      </div>
      <div v-show="canScrollDown" class="base-menu-left__nav-fade base-menu-left__nav-fade_bottom" aria-hidden="true">
        <span class="base-menu-left__nav-chevron">
          <ChevronDown :size="14" :stroke-width="1.75" aria-hidden="true" />
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
        active-class="base-menu-left__item_active"
        aria-label="Задачи"
        title="Задачи"
      >
        <ListTodo v-bind="navigationIconProps" />
      </NuxtLink>
      <NuxtLink
        aria-label="Чаты"
        title="Чаты"
        :to="{ name: PAGE_NAMES.CHAT }"
        class="base-menu-left__item base-menu-left__item_mob chat-icon-wrapper"
        active-class="base-menu-left__item_active"
      >
        <div v-if="totalUnreadCount > 0" class="chat-unread-badge">{{ totalUnreadCount }}</div>
        <MessagesSquare v-bind="navigationIconProps" />
      </NuxtLink>
      <NuxtLink
        v-if="(userStore.user?.role === ROLES.admin || userStore.user?.role === ROLES.employee) && isMenuVisible('mail')"
        aria-label="Почта"
        title="Почта"
        :to="{ name: PAGE_NAMES.MAIL }"
        class="base-menu-left__item base-menu-left__item_mob chat-icon-wrapper"
        active-class="base-menu-left__item_active"
      >
        <div v-if="mailInboxUnreadCount > 0" class="chat-unread-badge">{{ mailInboxUnreadCount }}</div>
        <Mail v-bind="navigationIconProps" />
      </NuxtLink>
      <NuxtLink
        v-if="userStore.user?.role === ROLES.admin && isMenuVisible('crm')"
        to="/crm/deals"
        class="base-menu-left__item base-menu-left__item_mob"
        :class="{ 'base-menu-left__item_active': isCrmRoute }"
        :aria-current="isCrmRoute ? 'page' : undefined"
        aria-label="CRM"
        title="CRM"
      >
        <Funnel v-bind="navigationIconProps" />
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
  padding: 20px 17px;
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
    padding: 16px var(--mobile-page-gutter) 10px;
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

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
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
      height: 44px;
      width: 44px;
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
    height: 44px;
    width: 44px;
    flex-shrink: 0;
    color: var(--light-text-backgroung-primary-50);
    border-radius: 8px;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;

    svg {
      flex-shrink: 0;
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
      color: var(--light-text-backgroung-primary);
    }

    &_active {
      background-color: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

    &_mob {
      width: 48px;
      height: 48px;
      flex: 0 0 48px;
      padding: 12px;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        background-color: var(--light-text-backgroung-primary-5);
        color: var(--light-text-backgroung-primary);
      }

      &_active:hover {
        background-color: var(--light-text-backgroung-primary-10);
      }
    }

    &:active {
      background-color: var(--light-text-backgroung-primary-25);
      color: var(--light-text-backgroung-primary);
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
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
