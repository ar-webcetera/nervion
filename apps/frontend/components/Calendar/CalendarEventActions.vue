<script setup lang="ts">
import type { CalendarEvent } from '@tracker/contracts';
import { Ellipsis, Pencil } from '@lucide/vue';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

defineProps<{ event: CalendarEvent }>();
const emit = defineEmits<{ edit: [] }>();

const isOpen = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
const position = ref({ left: '0px', top: '0px' });

const close = (restoreFocus = false) => {
  isOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
};

const edit = () => {
  close();
  emit('edit');
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' || event.key === 'Tab') {
    close(event.key === 'Escape');
  }
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
  positioning.stop = autoUpdate(trigger.value, menu.value, async () => {
    const { x, y } = await computePosition(trigger.value!, menu.value!, {
      strategy: 'fixed',
      placement: 'bottom-end',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
    });
    if (!disposed) position.value = { left: `${x}px`, top: `${y}px` };
  });
  menu.value.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
});
</script>

<template>
  <div class="calendar-event-actions" @click.stop @pointerdown.stop>
    <button
      ref="trigger"
      type="button"
      class="calendar-event-actions__trigger"
      :aria-label="`Действия встречи: ${event.title}`"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      :aria-controls="isOpen ? menuId : undefined"
      @click="isOpen = !isOpen"
      @keydown.down.prevent="isOpen = true"
    >
      <Ellipsis :size="17" :stroke-width="2" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        :id="menuId"
        ref="menu"
        class="calendar-event-actions__menu"
        :style="position"
        role="menu"
        :aria-label="`Действия встречи: ${event.title}`"
        @click.stop
        @keydown="onKeydown"
      >
        <button type="button" role="menuitem" tabindex="-1" @click="edit">
          <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" />
          Изменить
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.calendar-event-actions {
  position: absolute;
  z-index: 2;
  top: 3px;
  right: 3px;

  &__trigger {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: color-mix(in srgb, var(--dark-text-background-primary) 28%, transparent);
    color: color-mix(in srgb, var(--light-text-backgroung-primary) 75%, var(--event-color));
    cursor: pointer;
    @include flex(center);

    &:hover,
    &[aria-expanded='true'] {
      background: color-mix(in srgb, var(--dark-text-background-primary) 62%, transparent);
      color: var(--light-text-backgroung-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--light-text-backgroung-primary);
      outline-offset: 1px;
    }
  }

  &__menu {
    position: fixed;
    z-index: 10002;
    min-width: 150px;
    padding: 4px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 8px;
    background: var(--dark-text-background-primary);
    box-shadow: 0 8px 24px var(--black-50);

    button {
      width: 100%;
      min-height: 40px;
      padding: 8px 10px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--light-text-backgroung-primary);
      text-align: left;
      cursor: pointer;
      @include flex(rn, a-center, j-start);
      gap: 8px;
      @extend %text-s-regular;

      &:hover,
      &:focus-visible {
        background: var(--light-text-backgroung-primary-10);
        outline: none;
      }
    }
  }
}

@media (pointer: coarse) {
  .calendar-event-actions {
    top: 0;
    right: 0;

    &__trigger {
      width: 36px;
      height: 36px;
    }

    &__menu button {
      min-height: 44px;
    }
  }
}
</style>
