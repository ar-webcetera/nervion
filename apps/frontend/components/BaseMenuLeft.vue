<script setup lang="ts">
import { useRootStore } from '~/stores/rootStore';
import { PAGE_NAMES } from '~/constants/pages.constants';
import { ROLES } from '~/types/user';
import { useTaskStore } from '~/stores/taskStore';
import { useNotificationStore } from '~/stores/notificationStore';
import { useChatStore } from '~/stores/chatStore';
import { useMailStore } from '~/stores/mailStore';
import BaseTopTracker from '~/components/BaseTopTracker.vue';
import { MENU_ITEMS, isMenuItemAllowedForRole } from '~/constants/menu.constants';
import { computed, type Component } from 'vue';
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
  Menu,
  X,
  Bell,
  Timer,
  UserRound,
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
const isMobileMenuOpen = ref(false);
const mobileMenuButtonRef = ref<HTMLButtonElement | null>(null);
const mobileMenuCloseRef = ref<HTMLButtonElement | null>(null);
const mobileMenuPanelRef = ref<HTMLElement | null>(null);
const notificationPanelRef = ref<{ open: () => void } | null>(null);
const timeTrackerPanelRef = ref<{ open: () => void } | null>(null);

const mobileNavigationIcons: Record<string, Component> = {
  projects: FolderKanban,
  crm: Funnel,
  wiki: BookOpen,
  planning: CalendarDays,
  schedule: CalendarClock,
  report: ChartNoAxesCombined,
  'users-management': Users,
  changelogs: ScrollText,
  'audit-logs': ListChecks,
  healthchecks: MonitorCheck,
  'mail-accounts': Mailbox,
  git: GitBranch,
};

const mobileMenuItems = computed(() =>
  MENU_ITEMS.filter((item) => {
    if (['home', 'chat', 'mail'].includes(item.key)) return false;
    if (!isMenuVisible(item.key) || !isMenuItemAllowedForRole(item, userStore.user?.role)) return false;
    if (item.key === 'schedule' && userStore.user?.role === ROLES.guest) return false;
    return Boolean(mobileNavigationIcons[item.key]);
  }).map((item) => ({ ...item, icon: mobileNavigationIcons[item.key] })),
);

const hasUnreadNotifications = computed(() => notificationStore.notifications.some((notification) => !notification.is_read));
const isMobileMoreRouteActive = computed(
  () => route.path !== '/' && !route.path.startsWith('/chat') && !route.path.startsWith('/mail'),
);

const openMobileMenu = async () => {
  isMobileMenuOpen.value = true;
  await nextTick();
  mobileMenuCloseRef.value?.focus();
};

const closeMobileMenu = (restoreFocus = true) => {
  isMobileMenuOpen.value = false;
  if (restoreFocus) void nextTick(() => mobileMenuButtonRef.value?.focus());
};

const openNotifications = () => {
  closeMobileMenu(false);
  requestAnimationFrame(() => notificationPanelRef.value?.open());
};

const openTimeTracker = () => {
  closeMobileMenu(false);
  requestAnimationFrame(() => timeTrackerPanelRef.value?.open());
};

const openMobileProfile = () => {
  closeMobileMenu(false);
  requestAnimationFrame(openPopup);
};

const trapMobileMenuFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab' || !mobileMenuPanelRef.value) return;
  const controls = Array.from(
    mobileMenuPanelRef.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
  );
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

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

watch(
  () => route.fullPath,
  () => {
    isMobileMenuOpen.value = false;
  },
);

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
        ref="notificationPanelRef"
        :notifications="notificationStore.notifications"
        @go-to-link="goToLink"
        @mark-all-as-read="markAllAsRead"
        @update-notifications="updateNotification"
      />
      <BaseTopTracker ref="timeTrackerPanelRef" />
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
      <Transition name="profile-popup">
        <div v-if="isPopupOpen" v-click-outside="closePopup" class="base-menu-left__profile-popup-layer">
          <BaseProfilePopup @close="closePopup" />
        </div>
      </Transition>
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
      <button
        ref="mobileMenuButtonRef"
        type="button"
        class="base-menu-left__item base-menu-left__item_mob base-menu-left__more-button"
        :class="{ 'base-menu-left__item_active': isMobileMenuOpen || isMobileMoreRouteActive }"
        aria-label="Открыть меню"
        title="Меню"
        :aria-expanded="isMobileMenuOpen"
        aria-controls="mobile-navigation-menu"
        @click="openMobileMenu"
      >
        <Menu v-bind="navigationIconProps" />
        <span v-if="hasUnreadNotifications" class="base-menu-left__more-indicator" aria-hidden="true"></span>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="mobile-menu-sheet">
        <div v-if="isMobileMenuOpen" class="mobile-more-menu">
          <button
            type="button"
            class="mobile-more-menu__backdrop"
            tabindex="-1"
            aria-label="Закрыть меню"
            @click="closeMobileMenu()"
          ></button>
          <section
            id="mobile-navigation-menu"
            ref="mobileMenuPanelRef"
            class="mobile-more-menu__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            @keydown.esc.stop.prevent="closeMobileMenu()"
            @keydown="trapMobileMenuFocus"
          >
            <header class="mobile-more-menu__header">
              <h2 id="mobile-navigation-title">Меню</h2>
              <button
                ref="mobileMenuCloseRef"
                type="button"
                class="mobile-more-menu__close"
                aria-label="Закрыть меню"
                title="Закрыть"
                @click="closeMobileMenu()"
              >
                <X :size="20" :stroke-width="1.75" aria-hidden="true" />
              </button>
            </header>

            <div class="mobile-more-menu__content">
              <div class="mobile-more-menu__quick-actions" aria-label="Быстрые действия">
                <button type="button" class="mobile-more-menu__quick-action" @click="openNotifications">
                  <span class="mobile-more-menu__quick-icon">
                    <Bell :size="20" :stroke-width="1.75" aria-hidden="true" />
                    <i v-if="hasUnreadNotifications" aria-hidden="true"></i>
                  </span>
                  <span>Уведомления</span>
                </button>
                <button type="button" class="mobile-more-menu__quick-action" @click="openTimeTracker">
                  <span class="mobile-more-menu__quick-icon">
                    <Timer :size="20" :stroke-width="1.75" aria-hidden="true" />
                  </span>
                  <span>Тайм-трекер</span>
                </button>
                <button type="button" class="mobile-more-menu__quick-action" @click="openMobileProfile">
                  <span class="mobile-more-menu__quick-icon mobile-more-menu__quick-icon_profile">
                    <img v-if="userStore.user?.photo_url" :src="userStore.user.photo_url" alt="" />
                    <UserRound v-else :size="20" :stroke-width="1.75" aria-hidden="true" />
                  </span>
                  <span>Профиль</span>
                </button>
              </div>

              <nav class="mobile-more-menu__navigation" aria-label="Дополнительные разделы">
                <NuxtLink
                  v-for="item in mobileMenuItems"
                  :key="item.key"
                  :to="{ name: item.page }"
                  class="mobile-more-menu__link"
                  active-class="mobile-more-menu__link_active"
                  @click="closeMobileMenu(false)"
                >
                  <component :is="item.icon" :size="20" :stroke-width="1.75" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                  <span v-if="item.key === 'report' && reportStore.pendingCount > 0" class="mobile-more-menu__count">
                    {{ reportStore.pendingCount }}
                  </span>
                </NuxtLink>
              </nav>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
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
    position: relative;
    flex: 0 0 0;
    max-width: unset;
    height: 0;
    padding: 0;
    gap: 0;
    border-right: 0;
  }

  &__bottom {
    margin-top: auto;

    @media (max-width: $screen-mobile-l) {
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      margin: 0;
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
      display: none;
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
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      gap: 0;
      overflow: visible;

      :deep(.notification),
      :deep(.base-top-tracker) {
        width: 0;
        height: 0;
        background: transparent;
      }

      :deep(.notification__icon),
      :deep(.timer-icon-wrapper) {
        display: none;
      }
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

  &__more-button {
    padding: 0;
    border: 0;
    background: transparent;
  }

  &__more-indicator {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger-delete);
  }
}

.mobile-more-menu {
  position: fixed;
  inset: 0;
  z-index: 1200;

  &__backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: var(--black-50);
    backdrop-filter: blur(4px);
  }

  &__sheet {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    max-height: calc(100dvh - 48px);
    @include flex(cn);
    border-radius: 16px 16px 0 0;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);
    box-shadow: 0 -12px 32px var(--black-50);
    overflow: hidden;
  }

  &__header {
    min-height: 68px;
    padding: 12px;
    flex: 0 0 auto;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, a-center, between);

    h2 {
      margin: 0;
      @extend %text-l-medium;
    }
  }

  &__close {
    width: 44px;
    height: 44px;
    padding: 0;
    flex: 0 0 44px;
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

  &__content {
    min-height: 0;
    padding: 16px 12px max(16px, env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  &__quick-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }

  &__quick-action {
    min-width: 0;
    min-height: 76px;
    padding: 10px 8px;
    gap: 8px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    @include flex(cn, center);
    @extend %text-xs-regular;

    &:hover,
    &:focus-visible {
      background: var(--light-text-backgroung-primary-10);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__quick-icon {
    position: relative;
    width: 28px;
    height: 28px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(center);

    i {
      position: absolute;
      top: 1px;
      right: 1px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--danger-delete);
    }

    &_profile {
      overflow: hidden;
      border-radius: 50%;
      background: var(--light-text-backgroung-primary-10);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
  }

  &__navigation {
    @include flex(cn);
    gap: 4px;
  }

  &__link {
    min-width: 0;
    min-height: 48px;
    padding: 12px;
    gap: 12px;
    border-radius: 8px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, a-center);
    @extend %text-s-regular;

    svg {
      flex: 0 0 auto;
    }

    > span:nth-child(2) {
      min-width: 0;
      flex: 1;
      overflow-wrap: anywhere;
    }

    &_active {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
    }

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

  &__count {
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--primary-25);
    color: var(--light-text-backgroung-primary);
    font-variant-numeric: tabular-nums;
    @include flex(center);
    @extend %text-xs-medium;
  }
}

.mobile-menu-sheet-enter-active {
  transition: opacity 0.22s ease;

  .mobile-more-menu__sheet {
    transition:
      transform 0.26s cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.22s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    .mobile-more-menu__sheet {
      transition: none;
    }
  }
}

.mobile-menu-sheet-leave-active {
  transition: opacity 0.16s ease;

  .mobile-more-menu__sheet {
    transition:
      transform 0.18s ease,
      opacity 0.16s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    .mobile-more-menu__sheet {
      transition: none;
    }
  }
}

.mobile-menu-sheet-enter-from,
.mobile-menu-sheet-leave-to {
  opacity: 0;

  .mobile-more-menu__sheet {
    transform: translateY(100%);
    opacity: 0;
  }
}

.profile-popup-enter-active {
  transition: opacity 0.2s ease;

  :deep(.base-profile-popup) {
    transition:
      transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    :deep(.base-profile-popup) {
      transition: none;
    }
  }
}

.profile-popup-leave-active {
  transition: opacity 0.14s ease;

  :deep(.base-profile-popup) {
    transition:
      transform 0.16s ease,
      opacity 0.14s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    :deep(.base-profile-popup) {
      transition: none;
    }
  }
}

.profile-popup-enter-from,
.profile-popup-leave-to {
  opacity: 0;

  :deep(.base-profile-popup) {
    transform: translateY(8px) scale(0.98);
    opacity: 0;
  }

  @media (max-width: $screen-mobile-l) {
    :deep(.base-profile-popup) {
      transform: translateX(100%);
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
