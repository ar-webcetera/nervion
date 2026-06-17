<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { WikiTreeNode } from '~/types/wiki';
import { WikiDndKey } from '~/composables/useWikiDnd';

const router = useRouter();

const props = defineProps<{
  wikiTreeNode: WikiTreeNode;
}>();

const dnd = inject(WikiDndKey)!;
const itemRef = ref<HTMLElement | null>(null);

const isOpen = ref(false);
const hasChildren = computed(() => props.wikiTreeNode.children && props.wikiTreeNode.children.length > 0);
const isCurrentPage = computed(
  () => props.wikiTreeNode.id === Number(router.currentRoute.value.query.page_id),
);

const isDragging = computed(() => dnd.draggingId.value === props.wikiTreeNode.id);
const isDropBefore = computed(
  () => dnd.dropTarget.value?.id === props.wikiTreeNode.id && dnd.dropTarget.value.zone === 'before',
);
const isDropAfter = computed(
  () => dnd.dropTarget.value?.id === props.wikiTreeNode.id && dnd.dropTarget.value.zone === 'after',
);
const isDropInto = computed(
  () => dnd.dropTarget.value?.id === props.wikiTreeNode.id && dnd.dropTarget.value.zone === 'into',
);

// Auto-expand when dragging hovers over this item
watch(
  () => dnd.expandTargetId.value,
  (id) => {
    if (id === props.wikiTreeNode.id && hasChildren.value && !isOpen.value) {
      isOpen.value = true;
    }
  },
);

const openPage = () => {
  router.push({
    query: {
      ...router.currentRoute.value.query,
      page_id: props.wikiTreeNode.id,
    },
  });
};

const onHandlePointerDown = (e: PointerEvent) => {
  if (itemRef.value) dnd.initDrag(e, props.wikiTreeNode.id, itemRef.value);
};
</script>

<template>
  <li
    ref="itemRef"
    class="wiki-menu-item"
    :class="{ 'wiki-menu-item_dragging': isDragging }"
    :data-page-id="wikiTreeNode.id"
  >
    <div
      class="wiki-menu-item__label"
      :class="{
        'wiki-menu-item_active': isCurrentPage,
        'wiki-menu-item__label_drop-before': isDropBefore,
        'wiki-menu-item__label_drop-after': isDropAfter,
        'wiki-menu-item__label_drop-into': isDropInto,
      }"
      @click="openPage"
    >
      <!-- Drag handle — абсолютный, не влияет на layout -->
      <span
        class="wiki-menu-item__drag-handle"
        data-handle
        @pointerdown.stop.prevent="onHandlePointerDown"
        @click.stop
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="2.5" cy="2" r="1.5" />
          <circle cx="7.5" cy="2" r="1.5" />
          <circle cx="2.5" cy="7" r="1.5" />
          <circle cx="7.5" cy="7" r="1.5" />
          <circle cx="2.5" cy="12" r="1.5" />
          <circle cx="7.5" cy="12" r="1.5" />
        </svg>
      </span>

      <!-- Стрелка у папок / плейсхолдер у листов для выравнивания -->
      <div
        v-if="hasChildren"
        class="wiki-menu-item__arrow"
        :class="{ 'wiki-menu-item__arrow_rotate': isOpen }"
        @click.stop="isOpen = !isOpen"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4 3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>

      <!-- Иконка -->
      <div class="wiki-menu-item__icon">
        <!-- Папка -->
        <svg v-if="hasChildren" width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M14.8359 16.6666L16.4942 16.6666C16.8545 16.6666 17.0349 16.6666 17.1863 16.6047C17.32 16.5501 17.4376 16.4614 17.5269 16.3478C17.6279 16.2192 17.6777 16.0462 17.7767 15.6995L18.6815 12.5329C18.8463 11.9559 18.9283 11.6674 18.8635 11.4391C18.8068 11.2392 18.6776 11.0677 18.5009 10.9582C18.311 10.8405 18.0334 10.8337 17.5002 10.8333M14.8359 16.6666H5.16409M14.8359 16.6666C15.7675 16.6666 16.2333 16.6666 16.5895 16.4851C16.9031 16.3253 17.1587 16.07 17.3185 15.7564C17.5002 15.3999 17.5002 14.9332 17.5002 13.9998V10.8333M5.16409 16.6666H4.26758C3.66793 16.6666 3.36729 16.6666 3.16569 16.5417C2.98903 16.4322 2.85953 16.2606 2.80281 16.0607C2.79086 16.0186 2.78394 15.9744 2.78163 15.9267M5.16409 16.6666C4.23249 16.6666 3.766 16.6666 3.40983 16.4851C3.1552 16.3554 2.93934 16.1625 2.78163 15.9267M17.5002 10.8333C17.4674 10.8333 17.4336 10.8333 17.3988 10.8333H4.1669L2.98584 14.967L2.98413 14.9727C2.8507 15.4398 2.77148 15.717 2.78163 15.9267M17.5002 10.8333L17.5002 7.6664C17.5002 6.73298 17.5002 6.26627 17.3185 5.90975C17.1587 5.59615 16.9033 5.34136 16.5897 5.18157C16.2331 4.99992 15.7668 4.99992 14.8333 4.99992H10M2.78163 15.9267C2.74511 15.8721 2.7117 15.8152 2.68166 15.7562C2.5 15.3997 2.5 14.9333 2.5 13.9999V4.99992M2.5 4.99992H10M2.5 4.99992C2.5 4.07944 3.24619 3.33325 4.16667 3.33325H7.22876C7.63642 3.33325 7.84072 3.33325 8.03253 3.3793C8.20259 3.42013 8.36488 3.48764 8.514 3.57902C8.68214 3.68206 8.82651 3.82643 9.11458 4.1145L10 4.99992"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <!-- Страница -->
        <svg v-else width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10.8333 16.6659C10.7542 16.6666 10.6654 16.6666 10.5641 16.6666H5.99734C5.06575 16.6666 4.59925 16.6666 4.24308 16.4851C3.92948 16.3253 3.6747 16.0701 3.51491 15.7565C3.33325 15.4 3.33325 14.9335 3.33325 14.0001V6.00008C3.33325 5.06666 3.33325 4.5996 3.51491 4.24308C3.6747 3.92948 3.92948 3.6747 4.24308 3.51491C4.5996 3.33325 5.06666 3.33325 6.00008 3.33325H14.0001C14.9335 3.33325 15.3996 3.33325 15.7561 3.51491C16.0697 3.6747 16.3253 3.92948 16.4851 4.24308C16.6666 4.59925 16.6666 5.06575 16.6666 5.99734V10.5622C16.6666 10.6643 16.6666 10.7537 16.6658 10.8333M10.8333 16.6659C11.0713 16.6637 11.2219 16.6551 11.3656 16.6206C11.5357 16.5798 11.6981 16.5122 11.8472 16.4208C12.0154 16.3177 12.1596 16.174 12.4478 15.8857L15.8857 12.4478C16.174 12.1596 16.3173 12.0154 16.4204 11.8472C16.5118 11.6981 16.5794 11.5353 16.6202 11.3652C16.6547 11.2215 16.6635 11.0711 16.6658 10.8333M10.8333 16.6659V12.1667C10.8333 11.7 10.8333 11.4664 10.9241 11.2882C11.004 11.1314 11.1314 11.004 11.2882 10.9241C11.4664 10.8333 11.6995 10.8333 12.1663 10.8333H16.6658"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <div class="wiki-menu-item__name">
        {{ wikiTreeNode.name }}
      </div>
    </div>

    <ul v-if="hasChildren && isOpen" class="wiki-menu-item__sub-menu">
      <WikiMenuItem v-for="child in wikiTreeNode.children" :key="child.id" :wiki-tree-node="child" />
    </ul>
  </li>
</template>

<style scoped lang="scss">
.wiki-menu-item {
  list-style: none;
  @include flex(cn);
  gap: 1px;

  &_dragging > .wiki-menu-item__label {
    opacity: 0.35;
    pointer-events: none;
  }

  &__label {
    position: relative;
    @include flex(rn, a-center);
    gap: 6px;
    cursor: pointer;
    // Левый padding — в нём живёт drag-handle (абсолютный, 14px шириной)
    padding: 5px 8px 5px 18px;
    border-radius: 6px;
    transition: background 0.15s ease;
    @extend %text-s-regular;
    color: var(--light-text-backgroung-primary);

    &:hover {
      background: var(--light-text-backgroung-primary-5);

      .wiki-menu-item__drag-handle {
        opacity: 1;
      }
    }

    &.wiki-menu-item_active {
      background: var(--primary-25);
      color: var(--primary);

      svg {
        stroke: var(--primary);
      }
    }

    // Drop zone indicators
    &_drop-before::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -2px;
      height: 2px;
      background: var(--primary);
      border-radius: 1px;
      pointer-events: none;
    }

    &_drop-after::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -2px;
      height: 2px;
      background: var(--primary);
      border-radius: 1px;
      pointer-events: none;
    }

    &_drop-into {
      background: var(--primary-25);
    }
  }

  &__drag-handle {
    position: absolute;
    left: 2px;
    top: 50%;
    transform: translateY(-50%);
    @include flex(center);
    width: 14px;
    height: 20px;
    color: var(--light-text-backgroung-primary-25);
    opacity: 0;
    cursor: grab;
    transition: opacity 0.12s ease;
    border-radius: 3px;

    &:active {
      cursor: grabbing;
    }
  }

  &__arrow {
    @include flex(center);
    flex-shrink: 0;
    cursor: pointer;
    transition: transform 0.2s ease;
    transform: rotate(0deg);
    color: var(--light-text-backgroung-primary-50);
    width: 16px;
    height: 16px;

    &_rotate {
      transform: rotate(90deg);
    }

    svg {
      stroke: currentColor;
    }
  }

  &__icon {
    @include flex(center);
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--light-text-backgroung-primary-50);

    svg {
      stroke: currentColor;
    }
  }

  &__name {
    flex: 1;
    user-select: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__sub-menu {
    margin-left: 18px;
    list-style: none;
    @include flex(cn);
    gap: 1px;
    padding-left: 6px;
    border-left: 1px solid var(--light-text-backgroung-primary-10);
  }
}
</style>
