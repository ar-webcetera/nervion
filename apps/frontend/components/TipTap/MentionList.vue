<script setup lang="ts">
import type { User } from '~/types/user';
import { useFullName } from '~/composables/useFullName';

interface Props {
  items: User[];
  command: (payload: { id: number; label: string }) => void;
}
const props = defineProps<Props>();

const selectedIndex = ref(0);

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0;
  },
);

const upHandler = () => {
  selectedIndex.value = (selectedIndex.value + props.items.length - 1) % props.items.length;
};
const downHandler = () => {
  selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
};
const enterHandler = () => {
  const item = props.items[selectedIndex.value];
  if (item) {
    props.command({ id: item.id, label: useFullName(item) || '' });
  }
};

const selectItem = (index: number) => {
  const item = props.items[index];
  if (item) {
    props.command({ id: item.id, label: useFullName(item) || '' });
  }
};

const onKeyDown = (data: { event: KeyboardEvent }): boolean => {
  const { key } = data.event;
  if (key === 'ArrowUp') {
    upHandler();
    return true;
  }
  if (key === 'ArrowDown') {
    downHandler();
    return true;
  }
  if (key === 'Enter') {
    enterHandler();
    return true;
  }
  return false;
};

defineExpose({ onKeyDown });
</script>

<template>
  <div class="dropdown-menu">
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="index"
        :class="['dropdown-menu__item', { 'dropdown-menu__item_selected': index === selectedIndex }]"
        @click="selectItem(index)"
      >
        {{ useFullName(item) }}
      </button>
    </template>
    <div v-else class="dropdown-menu__empty">No result</div>
  </div>
</template>

<style scoped lang="scss">
.dropdown-menu {
  @include flex(cn, a-start);
  overflow: auto;
  position: relative;
  border-radius: 8px;
  background: var(--dark-text-background-primary-50);
  z-index: 100;
  border: 1px solid var(--light-text-backgroung-primary-10);
  backdrop-filter: blur(12px);

  &__item {
    @include flex(rn, a-center, j-start);
    width: 100%;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-50);
    border-radius: 0;
    cursor: pointer;
    padding: 6px 8px;
    background: none;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }

    &_selected {
      background: var(--light-text-backgroung-primary-5);
    }
  }
}
</style>
