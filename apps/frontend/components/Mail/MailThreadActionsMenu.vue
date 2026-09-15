<script setup lang="ts">
import { Ellipsis, FolderInput, Mail, Trash2 } from '@lucide/vue';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

defineProps<{
  subject: string;
  canMarkUnread: boolean;
  permanentDelete: boolean;
}>();

const emit = defineEmits<{
  markUnread: [];
  move: [];
  delete: [];
}>();

const isOpen = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
const position = ref({ left: '0px', top: '0px' });

const close = (restoreFocus = false) => {
  isOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
};

const menuItems = () => Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
    return;
  }
  if (event.key === 'Tab') {
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  event.preventDefault();
  const items = menuItems();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  items[nextIndex]?.focus();
};

const activate = (action: 'markUnread' | 'move' | 'delete') => {
  close(true);
  if (action === 'markUnread') emit('markUnread');
  else if (action === 'move') emit('move');
  else emit('delete');
};

watch(isOpen, async (open, _, onCleanup) => {
  if (!open) return;

  let disposed = false;
  const positioning = { stop: undefined as (() => void) | undefined };
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && !menu.value?.contains(event.target) && !trigger.value?.contains(event.target)) close();
  };

  onCleanup(() => {
    disposed = true;
    positioning.stop?.();
    document.removeEventListener('pointerdown', onOutsidePointerDown);
  });

  await nextTick();
  if (disposed || !trigger.value || !menu.value) return;

  document.addEventListener('pointerdown', onOutsidePointerDown);
  positioning.stop = autoUpdate(trigger.value, menu.value, async () => {
    if (!trigger.value || !menu.value) return;
    const { x, y } = await computePosition(trigger.value, menu.value, {
      strategy: 'fixed',
      placement: 'bottom-end',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
    });
    if (!disposed) position.value = { left: `${x}px`, top: `${y}px` };
  });
  menuItems()[0]?.focus();
});
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="thread-actions__trigger"
    :aria-label="`Действия с письмом: ${subject}`"
    aria-haspopup="menu"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? menuId : undefined"
    @click.stop="isOpen = !isOpen"
    @keydown.down.prevent.stop="isOpen = true"
  >
    <Ellipsis :size="18" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div
      v-if="isOpen"
      :id="menuId"
      ref="menu"
      class="thread-actions__menu"
      :style="position"
      role="menu"
      :aria-label="`Действия с письмом: ${subject}`"
      @click.stop
      @keydown="onKeydown"
    >
      <button v-if="canMarkUnread" type="button" role="menuitem" tabindex="-1" @click="activate('markUnread')">
        <Mail :size="17" aria-hidden="true" />
        Отметить непрочитанным
      </button>
      <button type="button" role="menuitem" tabindex="-1" @click="activate('move')">
        <FolderInput :size="17" aria-hidden="true" />
        Перенести
      </button>
      <div role="separator" class="thread-actions__separator" />
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="thread-actions__danger"
        @click="activate('delete')"
      >
        <Trash2 :size="17" aria-hidden="true" />
        {{ permanentDelete ? 'Удалить навсегда' : 'Удалить' }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.thread-actions {
  &__trigger {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.16s ease,
      color 0.16s ease,
      background-color 0.16s ease;
    @include flex(center);

    &:hover,
    &[aria-expanded='true'] {
      background: var(--light-text-backgroung-primary-10);
      color: var(--light-text-backgroung-primary);
      opacity: 1;
    }

    &:focus-visible {
      outline: 2px solid var(--primary-50);
      outline-offset: 2px;
      opacity: 1;
    }
  }

  &__menu {
    position: fixed;
    z-index: 10002;
    min-width: 224px;
    padding: 4px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    box-shadow: 0 8px 24px var(--black-50);

    button {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      gap: 8px;
      padding: 8px 10px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--light-text-backgroung-primary);
      text-align: left;
      cursor: pointer;
      @include flex(rn, a-center, j-start);
      @extend %text-s-regular;

      &:hover,
      &:focus-visible {
        background: var(--light-text-backgroung-primary-10);
        outline: none;
      }
    }

    .thread-actions__danger {
      color: var(--danger-delete);
    }
  }

  &__separator {
    height: 1px;
    margin: 4px;
    background: var(--light-text-backgroung-primary-10);
  }

  @media (hover: none), (pointer: coarse) {
    &__trigger {
      width: 44px;
      height: 44px;
      opacity: 1;
    }

    &__menu button {
      min-height: 44px;
    }
  }
}
</style>
