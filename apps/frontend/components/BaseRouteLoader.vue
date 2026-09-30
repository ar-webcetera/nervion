<script setup lang="ts">
const nuxtApp = useNuxtApp();
const router = useRouter();
const isVisible = ref(false);

const SHOW_DELAY = 90;
const MIN_VISIBLE_TIME = 180;

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let shownAt = 0;
let isPageTransition = true;

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
  if (timer) clearTimeout(timer);
};

const start = () => {
  if (!isPageTransition) return;

  clearTimer(hideTimer);
  clearTimer(showTimer);
  hideTimer = null;
  showTimer = setTimeout(() => {
    shownAt = performance.now();
    isVisible.value = true;
    showTimer = null;
  }, SHOW_DELAY);
};

const finish = () => {
  clearTimer(showTimer);
  showTimer = null;

  if (!isVisible.value) return;

  const remainingTime = Math.max(0, MIN_VISIBLE_TIME - (performance.now() - shownAt));
  clearTimer(hideTimer);
  hideTimer = setTimeout(() => {
    isVisible.value = false;
    hideTimer = null;
  }, remainingTime);
};

let removeStartHook: (() => void) | undefined;
let removeFinishHook: (() => void) | undefined;
let removeErrorHook: (() => void) | undefined;
let removeBeforeEach: (() => void) | undefined;

if (import.meta.client) {
  removeBeforeEach = router.beforeEach((to, from) => {
    isPageTransition = to.path !== from.path;
  });
  removeStartHook = nuxtApp.hook('page:loading:start', start);
  removeFinishHook = nuxtApp.hook('page:loading:end', finish);
  removeErrorHook = nuxtApp.hook('app:error', finish);
}

onBeforeUnmount(() => {
  clearTimer(showTimer);
  clearTimer(hideTimer);
  removeStartHook?.();
  removeFinishHook?.();
  removeErrorHook?.();
  removeBeforeEach?.();
});
</script>

<template>
  <Transition name="route-loader">
    <div v-if="isVisible" class="route-loader" role="status" aria-live="polite" aria-label="Загрузка страницы">
      <span class="route-loader__spinner" aria-hidden="true"></span>
      <span class="route-loader__text">Загрузка страницы</span>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.route-loader {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--dark-text-background-primary-50);
  pointer-events: none;
  @include flex(center);

  &__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--light-text-backgroung-primary-10);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: route-loader-spin 0.7s linear infinite;
  }

  &__text {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    &__spinner {
      animation: none;
    }
  }
}

.route-loader-enter-active,
.route-loader-leave-active {
  transition: opacity 0.16s ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

.route-loader-enter-from,
.route-loader-leave-to {
  opacity: 0;
}

@keyframes route-loader-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
