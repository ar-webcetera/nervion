<script setup lang="ts">
import { Bell } from '@lucide/vue';
import { PushStatus } from '~/enums/push.enums';

const push = usePushStore();
const labels: Record<PushStatus, string> = {
  [PushStatus.Checking]: 'Проверяем подключение...',
  [PushStatus.Unsupported]: 'Этот браузер не поддерживает push-уведомления',
  [PushStatus.Blocked]: 'Заблокированы в браузере',
  [PushStatus.Disabled]: 'Выключены на этом устройстве',
  [PushStatus.Enabled]: 'Включены на этом устройстве',
  [PushStatus.Error]: 'Не удалось настроить уведомления',
};
onMounted(() => {
  void push.sync(true);
});
</script>

<template>
  <section class="profile-push" aria-labelledby="profile-push-title" :aria-busy="push.busy">
    <h2 id="profile-push-title" class="profile-push__title">
      <Bell :size="20" :stroke-width="1.75" aria-hidden="true" />
      Push-уведомления
    </h2>
    <p class="profile-push__status" role="status">{{ labels[push.status] }}</p>
    <p v-if="push.status === PushStatus.Blocked" class="profile-push__hint">
      В настройках сайта в браузере разрешите уведомления. На Android также проверьте разрешения для браузера или приложения в
      настройках телефона. Затем вернитесь сюда.
    </p>
    <p v-else-if="push.status === PushStatus.Unsupported" class="profile-push__hint">
      Откройте приложение по HTTPS в браузере с поддержкой уведомлений, например Chrome на Android.
    </p>
    <p v-else class="profile-push__hint">
      Только для этого браузера или установленного приложения. Другие устройства не затрагиваются.
    </p>
    <div v-if="push.status !== PushStatus.Unsupported" class="profile-push__actions">
      <button v-if="push.status === PushStatus.Blocked" type="button" :disabled="push.busy" @click="push.sync(true)">
        Проверить разрешение
      </button>
      <template v-else>
        <button
          v-if="push.status !== PushStatus.Enabled"
          type="button"
          class="profile-push__primary"
          :disabled="push.busy || push.status === PushStatus.Checking"
          @click="push.enable"
        >
          {{ push.busy ? 'Подождите...' : 'Включить' }}
        </button>
        <button
          v-if="push.status === PushStatus.Enabled || push.status === PushStatus.Error"
          type="button"
          :disabled="push.busy"
          @click="push.disable"
        >
          Выключить
        </button>
        <button v-if="push.status === PushStatus.Enabled" type="button" :disabled="push.busy" @click="push.test">
          {{ push.busy ? 'Подождите...' : 'Проверить уведомления' }}
        </button>
      </template>
    </div>
    <p v-if="push.message" class="profile-push__hint" role="status">{{ push.message }}</p>
  </section>
</template>

<style scoped lang="scss">
.profile-push {
  @include flex(cn);
  gap: 12px;
  min-width: 0;
  color: var(--light-text-backgroung-primary);
  &__title {
    @extend %text-m-medium;
    @include flex(rn a-center);
    gap: 8px;
    margin: 0;
    overflow-wrap: anywhere;
    svg {
      flex-shrink: 0;
    }
  }
  &__status {
    @extend %text-s-medium;
    margin: 0;
  }
  &__hint {
    @extend %text-s-regular;
    margin: 0;
    max-width: 48ch;
    overflow-wrap: anywhere;
    color: color-mix(in srgb, var(--light-text-backgroung-primary) 70%, var(--dark-text-background-primary));
  }
  &__actions {
    @include flex(rw);
    gap: 8px;
    button {
      @extend %text-s-medium;
      min-height: 44px;
      min-width: 0;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      padding: 8px 12px;
      border: 0;
      border-radius: 8px;
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
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
        cursor: wait;
      }
      &.profile-push__primary {
        background: var(--primary);
        &:hover:not(:disabled) {
          background: var(--primary-hover);
        }
      }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    &__actions button {
      transition: none;
    }
  }
}
</style>
