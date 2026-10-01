<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';
import { PushStatus } from '~/enums/push.enums';

const push = usePushStore();
const { $toast } = useNuxtApp();
const toggle = async (event: Event) => {
  const checkbox = event.target as HTMLInputElement;
  const shouldEnable = checkbox.checked;
  checkbox.checked = push.enabled;
  if (shouldEnable) await push.enable();
  else await push.disable();
  if (push.status === PushStatus.Blocked) {
    $toast.error('Разрешите уведомления в настройках сайта и в настройках телефона.', { duration: 6000 });
  } else if (push.status === PushStatus.Error) {
    $toast.error(push.message);
  }
};
const test = async () => {
  const sent = await push.test();
  if (sent) $toast.success(push.message, { duration: 6000 });
  else if (push.message) $toast.error(push.message, { duration: 6000 });
};
onMounted(async () => {
  await push.sync(true);
  if (push.status === PushStatus.Error && push.message) {
    $toast.error(push.message, { duration: 6000 });
  }
});
</script>

<template>
  <section class="profile-push" aria-label="Push-уведомления" :aria-busy="push.busy">
    <label class="profile-push__toggle">
      <input
        type="checkbox"
        :checked="push.enabled"
        :disabled="push.busy || push.status === PushStatus.Checking || push.status === PushStatus.Unsupported"
        @change="toggle"
      />
      <span>Push-уведомления</span>
      <LoaderCircle
        v-if="push.busy || push.status === PushStatus.Checking"
        class="profile-push__loader"
        :size="16"
        aria-hidden="true"
      />
    </label>
    <button type="button" class="profile-push__test" :disabled="push.busy || !push.enabled" @click="test">
      Проверить уведомления
    </button>
    <p v-if="push.status === PushStatus.Unsupported" class="profile-push__hint">Этот браузер не поддерживает push-уведомления.</p>
  </section>
</template>

<style scoped lang="scss">
.profile-push {
  @include flex(cn);
  gap: 8px;
  min-width: 0;
  color: var(--light-text-backgroung-primary);

  &__toggle {
    @extend %text-s-regular;
    @include flex(rn a-center);
    gap: 8px;
    min-height: 44px;
    cursor: pointer;
    span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    input {
      width: 16px;
      height: 16px;
      margin: 0;
      flex-shrink: 0;
      accent-color: var(--primary);
      cursor: pointer;
      &:focus-visible {
        outline: 2px solid var(--light-text-backgroung-primary);
        outline-offset: 3px;
      }
      &:disabled {
        cursor: default;
      }
    }
  }

  &__test {
    @extend %text-s-medium;
    align-self: flex-start;
    min-height: 44px;
    max-width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: 8px;
    background: var(--light-text-backgroung-primary-5);
    color: var(--light-text-backgroung-primary);
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
    transition: background-color 0.15s ease;
    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-10);
    }
    &:active:not(:disabled) {
      transform: translateY(1px);
    }
    &:focus-visible {
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: -4px;
    }
    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }

  &__hint {
    @extend %text-s-regular;
    margin: 0;
    color: color-mix(in srgb, var(--light-text-backgroung-primary) 70%, var(--dark-text-background-primary));
  }

  &__loader {
    flex-shrink: 0;
    animation: push-settings-spin 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    &__test {
      transition: none;
    }
    &__loader {
      animation: none;
    }
  }
}
@keyframes push-settings-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
