<script setup lang="ts">
import { Bell, LoaderCircle } from '@lucide/vue';

defineProps<{ busy: boolean }>();
defineEmits<{ allow: []; dismiss: [] }>();
</script>

<template>
  <section class="push-banner" aria-labelledby="push-banner-title" :aria-busy="busy">
    <div class="push-banner__heading">
      <Bell class="push-banner__icon" :size="20" :stroke-width="1.75" aria-hidden="true" />
      <h2 id="push-banner-title" class="push-banner__title">Уведомления</h2>
    </div>
    <p class="push-banner__description">Сообщать о задачах и новых сообщениях, даже когда приложение свёрнуто.</p>
    <div class="push-banner__actions">
      <button type="button" class="push-banner__allow" :disabled="busy" @click="$emit('allow')">
        <LoaderCircle v-if="busy" class="push-banner__loader" :size="16" aria-hidden="true" />
        {{ busy ? 'Подключение...' : 'Разрешить' }}
      </button>
      <button type="button" class="push-banner__dismiss" @click="$emit('dismiss')">Не сейчас</button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.push-banner {
  @include flex(cn);
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 990;
  width: 360px;
  max-width: calc(100% - 48px);
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  padding: 16px;
  gap: 12px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  background: var(--dark-text-background-secondary);
  color: var(--light-text-backgroung-primary);
  text-align: left;

  &__heading {
    @include flex(rn a-center);
    gap: 8px;
  }

  &__icon {
    flex-shrink: 0;
  }

  &__title {
    @extend %text-m-medium;
    margin: 0;
    min-width: 0;
  }

  &__description {
    @extend %text-s-regular;
    margin: 0;
    color: color-mix(in srgb, var(--light-text-backgroung-primary) 70%, var(--dark-text-background-secondary));
    overflow-wrap: anywhere;
  }

  &__actions {
    @include flex(rw);
    gap: 8px;
  }

  &__allow,
  &__dismiss {
    @extend %text-s-medium;
    @include flex(center);
    flex: 1 1 120px;
    min-height: 44px;
    padding: 8px 12px;
    gap: 8px;
    border: 0;
    border-radius: 8px;
    color: var(--light-text-backgroung-primary);
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:focus-visible {
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: -4px;
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
    }

    &:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  }

  &__allow {
    background: var(--primary);
    &:hover:not(:disabled) {
      background: var(--primary-hover);
    }
  }

  &__dismiss {
    background: var(--light-text-backgroung-primary-5);
    &:hover {
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__loader {
    flex-shrink: 0;
    animation: push-spin 1s linear infinite;
  }

  &.banner-enter-active,
  &.banner-leave-active {
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }

  &.banner-enter-from,
  &.banner-leave-to {
    opacity: 0;
    transform: translateY(8px);
  }

  @media (max-width: $screen-tablet) {
    right: max(var(--mobile-page-gutter), env(safe-area-inset-right));
    left: max(var(--mobile-page-gutter), env(safe-area-inset-left));
    bottom: calc(var(--mobile-nav-h) + 12px);
    width: auto;
    max-width: none;
    max-height: calc(100dvh - var(--mobile-nav-h) - env(safe-area-inset-top) - 24px);
  }

  @media (prefers-reduced-motion: reduce) {
    &__loader {
      animation: none;
    }
    &__allow,
    &__dismiss,
    &.banner-enter-active,
    &.banner-leave-active {
      transition: none;
    }
  }
}

@keyframes push-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
