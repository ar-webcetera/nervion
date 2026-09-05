<script setup lang="ts">
import { Check, Copy } from '@lucide/vue';
import { TASK_CODE_PREFIX } from '@tracker/contracts';

const props = defineProps<{ id: number | string }>();
const code = computed(() => `${TASK_CODE_PREFIX}-${props.id}`);
const copied = ref(false);
const { $toast } = useNuxtApp();
let resetTimer: ReturnType<typeof setTimeout> | undefined;
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    $toast.error('Не удалось скопировать код задачи');
  }
};
onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <button
    class="task-code"
    type="button"
    :title="copied ? 'Код скопирован' : `Скопировать ${code}`"
    :aria-label="`Скопировать код задачи ${code}`"
    @click.stop="copyCode"
    @pointerdown.stop
    @keydown.stop
    @dragstart.stop.prevent
  >
    <span>{{ code }}</span>
    <Check v-if="copied" :size="12" aria-hidden="true" />
    <Copy v-else :size="12" aria-hidden="true" />
    <span class="task-code__feedback" role="status">{{ copied ? 'Код скопирован' : '' }}</span>
  </button>
</template>

<style scoped lang="scss">
.task-code {
  @include flex(rn, a-center);
  @extend %text-xs-regular;
  position: relative;
  flex-shrink: 0;
  width: fit-content;
  gap: 4px;
  padding: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--light-text-backgroung-primary-50);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--light-text-backgroung-primary);
    background: var(--light-text-backgroung-primary-5);
  }

  &:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  &__feedback {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  @media (pointer: coarse) {
    min-height: 44px;
  }
}
</style>
