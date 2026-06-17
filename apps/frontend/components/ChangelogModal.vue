<script setup lang="ts">
import type { JSONContent } from '@tiptap/core';
import type { Changelog } from '~/stores/changelogStore';
import IconClose from '~/components/Icons/IconClose.vue';
import EditorTiptap from '~/components/TipTap/EditorTiptap.vue';

const changelogStore = useChangelogStore();

const current = ref<Changelog | null>(null);
const seenCount = ref(0);
const initialTotal = ref(0);

const hasNext = computed(() => seenCount.value < initialTotal.value - 1);
const show = computed(() => initialTotal.value > 0 && current.value !== null);

watch(
  () => changelogStore.unseen,
  (list) => {
    if (list.length > 0 && !current.value) {
      initialTotal.value = list.length;
      seenCount.value = 0;
      current.value = list[0];
    }
  },
  { immediate: true },
);

const close = async () => {
  if (!current.value) return;
  const next = hasNext.value;
  await changelogStore.markViewed(current.value.id);
  seenCount.value++;

  if (next) {
    current.value = changelogStore.unseen[0] ?? null;
  } else {
    current.value = null;
  }
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<template>
  <Teleport to="body">
    <Transition name="changelog-fade">
      <div v-if="show" class="changelog-overlay" @click.self="close">
        <div class="changelog-modal">
          <div class="changelog-modal__header">
            <div class="changelog-modal__meta">
              <span class="changelog-modal__badge">Что нового</span>
              <span v-if="initialTotal > 1" class="changelog-modal__counter">{{ seenCount + 1 }} / {{ initialTotal }}</span>
            </div>
            <button class="changelog-modal__close" @click="close">
              <IconClose />
            </button>
          </div>

          <div class="changelog-modal__body">
            <h2 class="changelog-modal__title">{{ current!.title }}</h2>
            <div class="changelog-modal__date">{{ formatDate(current!.created_at) }}</div>

            <div class="changelog-modal__content">
              <EditorTiptap
                v-if="current!.body"
                :key="current!.id"
                :value="current!.body as JSONContent"
                :model-value="current!.body as JSONContent"
                :is-editable="false"
              />
            </div>
          </div>

          <div class="changelog-modal__footer">
            <button class="button" @click="close">
              {{ hasNext ? 'Следующее обновление →' : 'Понятно!' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.changelog-fade-enter-active,
.changelog-fade-leave-active {
  transition: opacity 0.25s ease;
}
.changelog-fade-enter-from,
.changelog-fade-leave-to {
  opacity: 0;
}

.changelog-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--black-50);
  backdrop-filter: blur(4px);
  @include flex(center);
}

.changelog-modal {
  background: var(--light-text-backgroung-primary-5);
  border: 1px solid var(--light-text-backgroung-primary-10);
  border-radius: 12px;
  width: 640px;
  max-width: calc(100vw - 32px);
  max-height: 80vh;
  @include flex(cn);
  box-shadow: 0 24px 64px var(--black-40);

  &__header {
    @include flex(rn, a-center, between);
    padding: 20px 24px 0;
    flex-shrink: 0;
  }

  &__meta {
    @include flex(rn, a-center);
    gap: 8px;
  }

  &__badge {
    @extend %text-xs-medium;
    background: var(--primary-25);
    color: var(--primary);
    border: 1px solid var(--primary-25);
    border-radius: 999px;
    padding: 2px 10px;
  }

  &__counter {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
  }

  &__close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--light-text-backgroung-primary-50);
    @include flex(r);
    padding: 4px;
    border-radius: 6px;

    &:hover {
      color: var(--light-text-backgroung-primary);
      background: var(--light-text-backgroung-primary-10);
    }
  }

  &__body {
    padding: 16px 24px;
    overflow-y: auto;
    flex: 1;
  }

  &__title {
    @extend %text-l-bold;
    color: var(--light-text-backgroung-primary);
    margin: 0 0 4px;
  }

  &__date {
    @extend %text-xs-regular;
    color: var(--light-text-backgroung-primary-50);
    margin-bottom: 16px;
  }

  &__content {
    color: var(--light-text-backgroung-primary);
  }

  &__footer {
    padding: 16px 24px 20px;
    flex-shrink: 0;
    @include flex(rn, j-end);
    border-top: 1px solid var(--light-text-backgroung-primary-10);
  }
}
</style>
