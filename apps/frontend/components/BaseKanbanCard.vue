<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    as?: 'button' | 'div';
    type?: 'button' | 'submit' | 'reset';
    muted?: boolean;
  }>(),
  {
    as: 'button',
    type: 'button',
    muted: false,
  },
);
</script>

<template>
  <component
    :is="as"
    v-bind="$attrs"
    class="base-kanban-card"
    :class="{ 'base-kanban-card_muted': muted }"
    :type="as === 'button' ? type : undefined"
  >
    <slot name="media" />
    <div v-if="$slots.header" class="base-kanban-card__header">
      <slot name="header" />
    </div>
    <div class="base-kanban-card__title">
      <slot name="title" />
    </div>
    <div v-if="$slots.description" class="base-kanban-card__description">
      <slot name="description" />
    </div>
    <div v-if="$slots.footer" class="base-kanban-card__footer">
      <slot name="footer" />
    </div>
  </component>
</template>

<style scoped lang="scss">
.base-kanban-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  padding: 8px;
  gap: 0;
  border: none;
  border-radius: 8px;
  background: var(--light-text-backgroung-primary-5);
  box-shadow: 0 2px 4px 0 var(--black-10);
  color: var(--light-text-backgroung-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  backdrop-filter: blur(12px);
  @include flex(cn, a-start);

  &:hover {
    background: var(--light-text-backgroung-primary-10);
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  &_muted {
    text-decoration: line-through;
    opacity: 0.6;
  }

  &__header {
    width: 100%;
    min-width: 0;
    gap: 16px;
    color: var(--light-text-backgroung-primary-50);
    @include flex(rn, between, a-center);
    @extend %text-xs-regular;
  }

  &__title {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--light-text-backgroung-primary);
    @extend %text-s-medium;
  }

  &__description {
    width: 100%;
    min-width: 0;
    margin-top: 4px;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: color-mix(in srgb, var(--light-text-backgroung-primary) 70%, transparent);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    @extend %text-xs-regular;
  }

  &__footer {
    width: 100%;
    min-width: 0;
    margin-top: 8px;
    gap: 8px;
    @include flex(rw, a-center);
  }
}
</style>
