<script setup lang="ts">
import { X } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description?: string;
    wide?: boolean;
    busy?: boolean;
  }>(),
  {
    description: '',
    wide: false,
    busy: false,
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();

const dialogId = useId();
const titleId = `${dialogId}-title`;
const descriptionId = `${dialogId}-description`;
const dialog = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);

let active = false;
let opener: HTMLElement | null = null;
let background: HTMLElement | null = null;
let previousInert = false;
let previousOverflow = '';
let previousOverflowPriority = '';

const requestClose = () => {
  if (!props.busy) emit('update:modelValue', false);
};

const handleModelUpdate = (value: boolean) => {
  if (value) emit('update:modelValue', true);
  else requestClose();
};

const focusableElements = () => {
  if (!dialog.value) return [];
  return Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert], [hidden]') &&
      element.getClientRects().length > 0,
  );
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!active || !props.modelValue) return;

  if (event.key === 'Escape' && !event.defaultPrevented) {
    event.preventDefault();
    requestClose();
    return;
  }

  if (event.key !== 'Tab') return;
  const controls = focusableElements();
  const first = controls[0];
  const last = controls[controls.length - 1];
  const current = document.activeElement;

  if (!first || !last) {
    event.preventDefault();
    heading.value?.focus({ preventScroll: true });
  } else if (event.shiftKey && (current === first || !controls.includes(current as HTMLElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || !dialog.value?.contains(current))) {
    event.preventDefault();
    first.focus();
  }
};

const handleFocusIn = (event: FocusEvent) => {
  if (active && props.modelValue && dialog.value && !dialog.value.contains(event.target as Node)) {
    heading.value?.focus({ preventScroll: true });
  }
};

const activate = async () => {
  if (!import.meta.client || active || !props.modelValue) return;
  active = true;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  background = document.getElementById('__nuxt');
  previousInert = background?.inert ?? false;
  previousOverflow = document.body.style.getPropertyValue('overflow');
  previousOverflowPriority = document.body.style.getPropertyPriority('overflow');
  document.body.style.setProperty('overflow', 'hidden');
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('focusin', handleFocusIn);

  await nextTick();
  if (!active || !props.modelValue) return;
  const initial = dialog.value?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)');
  (initial ?? heading.value)?.focus({ preventScroll: true });
  if (background) background.inert = true;
};

const deactivate = () => {
  if (!import.meta.client || !active) return;
  active = false;
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('focusin', handleFocusIn);
  if (background) background.inert = previousInert;
  if (previousOverflow) document.body.style.setProperty('overflow', previousOverflow, previousOverflowPriority);
  else document.body.style.removeProperty('overflow');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
  background = null;
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) void activate();
    else deactivate();
  },
  { flush: 'post' },
);

onMounted(() => {
  if (props.modelValue) void activate();
});
onBeforeUnmount(deactivate);
</script>

<template>
  <Teleport to="body">
    <BaseModal
      class="platform-dialog"
      :class="{ 'platform-dialog_wide': wide }"
      :model-value="modelValue"
      :show-close="false"
      :dismissible="!busy"
      @update:model-value="handleModelUpdate"
    >
      <section
        ref="dialog"
        class="platform-dialog__panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        :aria-busy="busy"
      >
        <header class="platform-dialog__header">
          <div class="platform-dialog__heading">
            <h2 :id="titleId" ref="heading" class="platform-dialog__title" tabindex="-1">{{ title }}</h2>
            <p v-if="description" :id="descriptionId" class="platform-dialog__description">{{ description }}</p>
          </div>
          <button class="platform-dialog__close" type="button" aria-label="Закрыть окно" :disabled="busy" @click="requestClose">
            <X :size="20" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </header>
        <div class="platform-dialog__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="platform-dialog__footer">
          <slot name="footer" />
        </footer>
      </section>
    </BaseModal>
  </Teleport>
</template>

<style scoped lang="scss">
.platform-dialog {
  --platform-dialog-width: 520px;

  background: var(--black-50);

  &_wide {
    --platform-dialog-width: 720px;
  }

  :deep(.base-modal) {
    width: var(--platform-dialog-width);
    min-width: 0;
    max-width: calc(100vw - 32px);
    max-height: calc(100dvh - 32px);
    gap: 0;
  }

  :deep(.base-modal__content) {
    @include flex(cn);
    width: 100%;
    max-height: calc(100dvh - 32px);
    padding: 0;
    overflow: hidden;
    border-color: var(--light-text-backgroung-primary-10);
    border-radius: 12px;
  }

  &__panel {
    @include flex(cn);
    min-width: 0;
    min-height: 0;
    color: var(--light-text-backgroung-primary);
  }

  &__header {
    @include flex(rn, between, a-start);
    flex-shrink: 0;
    gap: 16px;
    padding: 24px 24px 16px;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__heading {
    min-width: 0;
  }

  &__title {
    @extend %h1;
    margin: 0;
    overflow-wrap: anywhere;

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 4px;
      border-radius: 4px;
    }
  }

  &__description {
    @extend %text-s-regular;
    margin: 8px 0 0;
    color: var(--light-text-backgroung-primary-50);
    overflow-wrap: anywhere;
  }

  &__close {
    @include flex(center);
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    margin: -8px -8px 0 0;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      color 0.16s ease;

    &:hover:not(:disabled) {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:active:not(:disabled) {
      background: var(--light-text-backgroung-primary-10);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  &__body {
    min-height: 0;
    min-width: 0;
    padding: 24px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scroll-padding-block: 24px;
  }

  &__footer {
    @include flex(rw, j-end, a-center);
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--light-text-backgroung-primary-10);
    background: var(--dark-text-background-primary);
  }

  @media (max-width: $screen-mobile-l) {
    :deep(.base-modal),
    :deep(.base-modal__content) {
      max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    }

    &__header {
      padding: 16px;
    }

    &__body {
      padding: 16px;
      scroll-padding-block: 16px;
    }

    &__footer {
      padding: 16px;
      gap: 8px;

      :slotted(button) {
        flex: 1 1 auto;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &__close {
      transition: none;
    }
  }
}
</style>
