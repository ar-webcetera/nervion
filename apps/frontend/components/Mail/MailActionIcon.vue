<script setup lang="ts">
import { FolderInput, GlobeLock, ShieldAlert, ShieldCheck, Trash2, Undo2 } from '@lucide/vue';

const props = defineProps<{
  name: 'move' | 'delete' | 'spam-sender' | 'spam-domain' | 'not-spam' | 'restore';
}>();

const icons = {
  move: FolderInput,
  delete: Trash2,
  'spam-sender': ShieldAlert,
  'spam-domain': GlobeLock,
  'not-spam': ShieldCheck,
  restore: Undo2,
} as const;

const icon = computed(() => icons[props.name]);
</script>

<template>
  <component :is="icon" class="mail-action-icon" :size="20" :stroke-width="2" aria-hidden="true" />
</template>

<style scoped lang="scss">
.mail-action-icon {
  display: block;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
}
</style>
