<script setup lang="ts">
import { Ellipsis, FolderOpen, ExternalLink, Download, Trash2 } from '@lucide/vue';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { FileTreeNode } from '~/utils/wiki/fileTree';

const props = defineProps<{ node: FileTreeNode; downloadUrl?: string }>();
const emit = defineEmits<{ open: []; delete: [] }>();
const isOpen = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
const position = ref({ left: '0px', top: '0px' });

const close = (restoreFocus = false) => {
  isOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
};
const items = () => Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === 'Tab') {
    close(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const options = items();
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    options[next]?.focus();
  }
};
const activate = (action: 'open' | 'delete') => {
  close(true);
  if (action === 'open') emit('open');
  else emit('delete');
};
watch(isOpen, async (open, _, onCleanup) => {
  if (!open) return;
  let disposed = false;
  const positioning = { stop: undefined as (() => void) | undefined };
  const outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !menu.value?.contains(event.target) && !trigger.value?.contains(event.target)) close();
  };
  onCleanup(() => {
    disposed = true;
    positioning.stop?.();
    document.removeEventListener('pointerdown', outside);
  });
  await nextTick();
  if (disposed || !trigger.value || !menu.value) return;
  document.addEventListener('pointerdown', outside);
  const reference = trigger.value;
  const floating = menu.value;
  positioning.stop = autoUpdate(reference, floating, async () => {
    const { x, y } = await computePosition(reference, floating, {
      strategy: 'fixed', placement: 'bottom-end', middleware: [offset(4), flip(), shift({ padding: 8 })],
    });
    if (!disposed) position.value = { left: `${x}px`, top: `${y}px` };
  });
  items()[0]?.focus();
});
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="file-actions__trigger"
    :aria-label="`Действия: ${props.node.name}`"
    aria-haspopup="menu"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? menuId : undefined"
    @click.stop="isOpen = !isOpen"
    @keydown.down.prevent.stop="isOpen = true"
  ><Ellipsis :size="18" /></button>
  <Teleport to="body">
    <div
      v-if="isOpen"
      :id="menuId"
      ref="menu"
      class="file-actions__menu"
      :style="position"
      role="menu"
      :aria-label="`Действия: ${props.node.name}`"
      @click.stop
      @keydown="onKeydown"
    >
      <button type="button" role="menuitem" tabindex="-1" @click="activate('open')">
        <FolderOpen v-if="node.type === 'folder'" :size="16" /><ExternalLink v-else :size="16" />
        Открыть
      </button>
      <a
        v-if="node.type === 'file'"
        role="menuitem"
        tabindex="-1"
        :href="downloadUrl"
        :download="node.name"
        target="_blank"
        rel="noopener noreferrer"
        @click="close(true)"
      >
        <Download :size="16" />Скачать
      </a>
      <div role="separator" class="file-actions__separator" />
      <button type="button" role="menuitem" tabindex="-1" class="file-actions__danger" @click="activate('delete')">
        <Trash2 :size="16" />Удалить
      </button>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.file-actions {
  &__trigger {
    @include flex(center);
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--light-text-backgroung-primary-50);
    cursor: pointer;
    &:hover, &[aria-expanded='true'] { background: var(--light-text-backgroung-primary-10); color: var(--light-text-backgroung-primary); }
    &:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  }
  &__menu {
    position: fixed;
    z-index: 10002;
    min-width: 168px;
    padding: 4px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    box-shadow: 0 8px 24px var(--black-50);
    button, a {
      @include flex(rn, a-center, j-start);
      @extend %text-s-regular;
      box-sizing: border-box;
      width: 100%;
      gap: 8px;
      padding: 8px 10px;
      border: 0;
      border-radius: 4px;
      color: var(--light-text-backgroung-primary);
      background: transparent;
      text-decoration: none;
      text-align: left;
      cursor: pointer;
      &:hover, &:focus-visible { background: var(--light-text-backgroung-primary-10); outline: none; }
    }
    .file-actions__danger { color: var(--danger-delete); }
  }
  &__separator { height: 1px; margin: 4px; background: var(--light-text-backgroung-primary-10); }
}
@media (pointer: coarse) {
  .file-actions__trigger { width: 44px; height: 44px; }
  .file-actions__menu { button, a { min-height: 44px; } }
}
</style>
