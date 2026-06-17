<script setup lang="ts">
import IconConfirm from '~/components/Icons/IconConfirm.vue';
import IconClose from '~/components/Icons/IconClose.vue';
import { ToastType } from '~/plugins/toast';
import IconTrash from './Icons/IconTrash.vue';
import IconToastUser from './Icons/IconToastUser.vue';

defineProps({
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <transition name="toast" appear>
    <div :class="['base-toast', `base-toast_${type}`]">
      <IconConfirm v-if="type === ToastType.SUCCESS" />
      <IconClose v-if="type === ToastType.ERROR" />
      <IconTrash v-if="type === ToastType.TRASH" />
      <IconToastUser v-if="type === ToastType.USER" />

      <span>
        {{ message }}
      </span>
    </div>
  </transition>
</template>

<style lang="scss" scoped>
.base-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--light-text-backgroung-primary-10);
  background: var(--light-text-backgroung-primary-5);
  @extend %text-s-regular;
  z-index: 4000;
  @include flex(rn, a-start);
  gap: 4px;
  color: var(--light-text-backgroung-primary);
  backdrop-filter: blur(12px);
  max-width: 280px;

  &_error {
    border-color: var(--danger-delete-50);
    background: var(--danger-delete-25);

    svg {
      fill: var(--secondary);
      width: 16px;
      height: 16px;
    }
  }

  &_success {
    svg {
      fill: var(--green);
    }
  }

  span {
    flex: 1;
  }
}

.toast-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.toast-enter-active {
  transition:
    transform 150ms ease-out,
    opacity 150ms ease-out;
}

.toast-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.toast-leave-active {
  transition:
    transform 150ms ease-in,
    opacity 150ms ease-in;
}
</style>
