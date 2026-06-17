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
  <BaseImageModal ref="modal" header="Настройка урока">
    <div class="modal-content"></div>
  </BaseModal>
</template>
-->

<script setup lang="ts">
import IconClose from '~/components/Icons/IconClose.vue';

const emit = defineEmits(['close']);
const isOpen = ref(false);

const open = () => {
  isOpen.value = true;
};

const close = () => {
  isOpen.value = false;
  emit('close');
};

defineExpose({
  open,
  close,
});
</script>
<template>
  <div v-if="isOpen" class="base-image-modal__overlay">
    <div class="base-image-modal" @click="close">
      <div class="base-image-modal__header">
        <div class="base-image-modal__header-close">
          <IconClose />
        </div>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.base-image-modal {
  @include flex(cn, j-center);
  padding: 12px;
  position: relative;
  border-radius: 16px;
  width: 100%;
  height: 100dvh;
  top: 0;
  left: 50%;
  transform: translateX(-50%);

  &__overlay {
    position: fixed;
    z-index: 10000;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    overflow-y: hidden;
    background-color: var(--black-50);
    backdrop-filter: blur(16px);
  }

  &__header {
    @include flex(rn, center);
    gap: 16px;
    padding: 0 32px;
  }

  &__header-close {
    @include flex(center);
    cursor: pointer;

    svg {
      width: 32px;
      height: 32px;
    }
  }

  & > * {
    &:last-child {
      margin-top: 4px;
    }
  }
}
</style>
