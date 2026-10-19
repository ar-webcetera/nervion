<script setup lang="ts">
import { X } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    subtitle?: string;
    dismissible?: boolean;
    size?: 'compact' | 'wide';
  }>(),
  {
    subtitle: '',
    dismissible: true,
    size: 'wide',
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'close'): void;
}>();

const panelRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const mounted = ref(false);
const hasBodyLock = ref(false);
const emitCloseAfterLeave = ref(false);
const previousFocus = ref<HTMLElement | null>(null);
const bodyLockCount = useState<number>('base-bottom-sheet-lock-count', () => 0);
const previousBodyOverflow = useState<string>('base-bottom-sheet-body-overflow', () => '');

const lockBody = () => {
  if (!import.meta.client || hasBodyLock.value) return;
  if (bodyLockCount.value === 0) previousBodyOverflow.value = document.body.style.overflow;
  bodyLockCount.value += 1;
  document.body.style.overflow = 'hidden';
  hasBodyLock.value = true;
};

const unlockBody = () => {
  if (!import.meta.client || !hasBodyLock.value) return;
  bodyLockCount.value = Math.max(0, bodyLockCount.value - 1);
  hasBodyLock.value = false;
  if (bodyLockCount.value === 0) document.body.style.overflow = previousBodyOverflow.value;
};

const focusSheet = async () => {
  previousFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  lockBody();
  await nextTick();
  closeButtonRef.value?.focus();
};

const restoreFocus = async () => {
  unlockBody();
  await nextTick();
  if (bodyLockCount.value === 0 && previousFocus.value?.isConnected) previousFocus.value.focus();
  previousFocus.value = null;
};

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!mounted.value) return;
    if (isOpen) void focusSheet();
    else void restoreFocus();
  },
);

onMounted(() => {
  mounted.value = true;
  if (props.modelValue) void focusSheet();
});

onBeforeUnmount(() => {
  unlockBody();
});

const requestClose = () => {
  if (!props.dismissible) return;
  emitCloseAfterLeave.value = true;
  emit('update:modelValue', false);
};

const handleAfterLeave = () => {
  if (!emitCloseAfterLeave.value) return;
  emitCloseAfterLeave.value = false;
  emit('close');
};

const trapFocus = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== 'Tab' || !panelRef.value) return;

  const controls = Array.from(
    panelRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!controls.length) {
    event.preventDefault();
    panelRef.value.focus();
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="bottom-sheet" @after-leave="handleAfterLeave">
      <div v-if="modelValue" class="base-bottom-sheet">
        <button
          type="button"
          class="base-bottom-sheet__backdrop"
          tabindex="-1"
          aria-label="Закрыть панель"
          @click="requestClose"
        ></button>
        <section
          ref="panelRef"
          class="base-bottom-sheet__panel"
          :class="`base-bottom-sheet__panel_${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          @keydown="trapFocus"
        >
          <header class="base-bottom-sheet__header">
            <div class="base-bottom-sheet__heading">
              <h2>{{ title }}</h2>
              <p v-if="subtitle">{{ subtitle }}</p>
            </div>
            <button
              v-if="dismissible"
              ref="closeButtonRef"
              type="button"
              class="base-bottom-sheet__close"
              aria-label="Закрыть"
              title="Закрыть"
              @click="requestClose"
            >
              <X :size="20" :stroke-width="1.75" aria-hidden="true" />
            </button>
          </header>
          <div class="base-bottom-sheet__content">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.base-bottom-sheet {
  position: fixed;
  inset: 0;
  z-index: 2200;

  &__backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: var(--black-50);
    backdrop-filter: blur(10px);
  }

  &__panel {
    position: absolute;
    top: 50%;
    left: 50%;
    max-height: calc(100dvh - 32px);
    overflow: hidden;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    box-shadow: 0 16px 48px var(--black-50);
    color: var(--light-text-backgroung-primary);
    outline: none;
    transform: translate(-50%, -50%);
    @include flex(cn);

    &_compact {
      width: min(580px, calc(100% - 32px));
    }

    &_wide {
      width: min(668px, calc(100% - 32px));
    }
  }

  &__header {
    min-height: 68px;
    padding: 12px 16px 12px 24px;
    flex: 0 0 auto;
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @include flex(rn, a-center, between);
    gap: 16px;
  }

  &__heading {
    min-width: 0;

    h2,
    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    h2 {
      @extend %text-l-medium;
    }

    p {
      margin-top: 2px;
      color: var(--light-text-backgroung-primary-50);
      @extend %text-xs-regular;
    }
  }

  &__close {
    width: 44px;
    height: 44px;
    padding: 0;
    flex: 0 0 44px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    @include flex(center);

    &:hover,
    &:focus-visible {
      background: var(--light-text-backgroung-primary-5);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }
  }

  &__content {
    min-height: 0;
    width: 100%;
    padding: 24px 0 max(24px, env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @media (max-width: $screen-tablet) {
    &__panel {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: 100vw;
      max-width: none;
      max-height: calc(100dvh - 48px);
      margin: 0;
      border: 0;
      border-top: 1px solid var(--light-text-backgroung-primary-10);
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -12px 32px var(--black-50);
      transform: none;
    }

    &__header {
      padding: 12px;
    }

    &__content {
      padding: 16px 0 max(16px, env(safe-area-inset-bottom));
    }

    &__backdrop {
      backdrop-filter: blur(4px);
    }
  }
}

.bottom-sheet-enter-active {
  transition: opacity 0.22s ease;

  .base-bottom-sheet__panel {
    transition:
      transform 0.26s cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.22s ease;
  }
}

.bottom-sheet-leave-active {
  transition: opacity 0.16s ease;

  .base-bottom-sheet__panel {
    transition:
      transform 0.18s ease,
      opacity 0.16s ease;
  }
}

.bottom-sheet-enter-from,
.bottom-sheet-leave-to {
  opacity: 0;

  .base-bottom-sheet__panel {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 8px)) scale(0.985);
  }

  @media (max-width: $screen-tablet) {
    .base-bottom-sheet__panel {
      transform: translateY(100%);
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .bottom-sheet-enter-active,
  .bottom-sheet-leave-active,
  .bottom-sheet-enter-active .base-bottom-sheet__panel,
  .bottom-sheet-leave-active .base-bottom-sheet__panel {
    transition: none;
  }
}
</style>
