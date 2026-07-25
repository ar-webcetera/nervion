<!--
Пример использования:

<script>
const modal = ref(null);
const openModal = () => {
  modal.value.open();
};

const closeModal = () => {
  modal.value.close();
};
</script>

<template>
  <BaseModal ref="modal">
    <div class="modal-content"></div>
  </BaseModal>
</template>
-->

<script setup lang="ts">
import IconClose from '~/components/Icons/IconClose.vue';

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    dismissible?: boolean;
  }>(),
  {
    dismissible: true,
  },
);

const emit = defineEmits(['close', 'update:modelValue']);
const isOpen = ref(Boolean(props.modelValue));

watch(
  () => props.modelValue,
  (value) => {
    if (typeof value === 'boolean') {
      isOpen.value = value;
    }
  },
  { immediate: true },
);

const open = () => {
  isOpen.value = true;
  emit('update:modelValue', true);
};

const close = () => {
  if (!props.dismissible) return;
  isOpen.value = false;
  emit('update:modelValue', false);
  emit('close');
};

defineExpose({
  open,
  close,
});
</script>

<template>
  <Transition name="modal">
    <div v-if="isOpen" class="base-modal__overlay" @click.self="close">
      <div class="base-modal">
        <div class="base-modal__header">
          <button
            v-if="dismissible"
            class="base-modal__header-close"
            type="button"
            aria-label="Закрыть"
            @click="close"
          >
            <IconClose />
          </button>
        </div>
        <div class="base-modal__content">
          <slot />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.base-modal {
  @include flex(cn, center);
  gap: 16px;
  position: relative;
  height: fit-content;
  width: fit-content;
  top: 0;
  left: 50%;
  transform: translateX(-50%);

  @media (max-width: $screen-mobile-l) {
    width: calc(100% - 32px);
  }

  &__overlay {
    @include flex(a-center);
    position: fixed;
    z-index: 2000;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  &__header {
    @include flex(rn, center);
  }

  &__header-close {
    display: flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  &__content {
    width: 460px;
    max-width: 100%;
    padding: 24px 0;
    border-radius: 8px;
    border: 1px solid var(--light-text-backgroung-primary-5);
    background: var(--dark-text-background-primary);
  }
}

.modal-enter-active {
  transition: opacity 0.2s ease;
}
.modal-leave-active {
  transition: opacity 0.16s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .base-modal {
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
}
.modal-leave-active .base-modal {
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.modal-enter-from .base-modal,
.modal-leave-to .base-modal {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.985);
}
</style>
