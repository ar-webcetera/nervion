<script setup lang="ts">
defineProps<{
  toggle: boolean;
}>();

const emit = defineEmits(['toggle']);
</script>

<template>
  <div class="base-toggle__container">
    <div :class="['base-toggle', { 'base-toggle_active': toggle }]" @click="emit('toggle')" />
  </div>
</template>

<style scoped lang="scss">
.base-toggle {
  border-radius: 30px;
  width: 29.333px;
  height: 17.333px;
  background-color: var(--white-50);
  position: relative;
  transition: all 0.2s ease;
  cursor: pointer;

  &:before {
    content: '';
    position: absolute;
    bottom: 2px;
    height: 13.333px;
    aspect-ratio: 1;
    background-color: var(--white-100);
    border-radius: 1000px;
    transition: all 0.2s ease;
    transform: translateX(2px);
  }

  &__container {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &_active {
    background-color: var(--primary-100);

    &:before {
      transform: translateX(100%);
    }
  }
}
</style>
