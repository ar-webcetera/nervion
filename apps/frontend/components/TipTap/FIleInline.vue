<script setup lang="ts">
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/vue-3';
import IconFile from '../Icons/IconFile.vue';

const props = defineProps<NodeViewProps>();

type FileAttrs = { href: string; name: string; ext?: string };
const a = props.node.attrs as FileAttrs;

const href = a.href;
const label = `${a.name}${a.ext ? '.' + a.ext : ''}`;
</script>

<template>
  <NodeViewWrapper as="span" class="file-inline" contenteditable="false" draggable="true">
    <IconFile />
    <a class="file-inline__link" :href="href" target="_blank" rel="noopener noreferrer" title="Открыть файл в новой вкладке">
      {{ label }}
    </a>
  </NodeViewWrapper>
</template>

<style scoped lang="scss">
.file-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  svg {
    width: 20px;
    height: 20px;
    stroke: var(--primary);
  }

  &__link {
    color: var(--primary);
    flex: 1;
  }
}
</style>
