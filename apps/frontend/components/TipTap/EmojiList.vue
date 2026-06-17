<script setup lang="ts">
interface EmojiItem {
  name: string;
  emoji: string;
  shortcodes?: string[];
}

interface Props {
  items: EmojiItem[];
  command: (payload: { name: string }) => void;
}

const props = defineProps<Props>();

const selectedIndex = ref(0);
const dropdownRef = ref<HTMLElement | null>(null);

const scrollToSelected = () => {
  const dropdown = dropdownRef.value;
  if (!dropdown || props.items.length === 0) return;

  const selectedEl = dropdown.querySelector<HTMLElement>(`[data-emoji-index="${selectedIndex.value}"]`);
  selectedEl?.scrollIntoView({ block: 'nearest' });
};

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0;
  },
);

watch(selectedIndex, () => {
  nextTick(scrollToSelected);
});

const upHandler = () => {
  if (props.items.length === 0) return;
  selectedIndex.value = (selectedIndex.value + props.items.length - 1) % props.items.length;
};
const downHandler = () => {
  if (props.items.length === 0) return;
  selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
};
const enterHandler = () => {
  const item = props.items[selectedIndex.value];
  if (item) {
    props.command({ name: item.name });
  }
};

const selectItem = (index: number) => {
  const item = props.items[index];
  if (item) {
    props.command({ name: item.name });
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
  <div ref="dropdownRef" class="emoji-dropdown">
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="item.name"
        :data-emoji-index="index"
        :class="['emoji-dropdown__item', { 'emoji-dropdown__item_selected': index === selectedIndex }]"
        @click="selectItem(index)"
      >
        <span class="emoji-dropdown__emoji">{{ item.emoji }}</span>
        <span class="emoji-dropdown__name">{{ item.name }}</span>
      </button>
    </template>
    <div v-else class="emoji-dropdown__empty">Ничего не найдено</div>
  </div>
</template>

<style scoped lang="scss">
.emoji-dropdown {
  @include flex(cn, a-start);
  max-height: 200px;
  overflow-y: auto;
  position: relative;
  border-radius: 8px;
  background: var(--dark-text-background-primary);
  z-index: 100;
  border: 1px solid var(--light-text-backgroung-primary-10);

  &__item {
    @include flex(rn, a-center, j-start);
    width: 100%;
    gap: 8px;
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

  &__emoji {
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
  }

  &__name {
    color: var(--light-text-backgroung-primary-50);
  }

  &__empty {
    padding: 6px 8px;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary-25);
  }
}
</style>
