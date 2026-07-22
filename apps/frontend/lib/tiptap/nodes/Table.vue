<script setup lang="ts">
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import IconTableColumnAdd from '../../../components/icons/IconTableColumnAdd.vue';
import IconTableColumnDelete from '../../../components/icons/IconTableColumnDelete.vue';
import IconTableLineAdd from '../../../components/icons/IconTableLineAdd.vue';
import IconTableLineDelete from '../../../components/icons/IconTableLineDelete.vue';
import IconTableDelete from '../../../components/icons/IconTableDelete.vue';

const editorStore = useEditorStore();

defineOptions({ name: 'TiptapTableNodeView' });

const props = defineProps<{
  deleteNode?: () => void;
  getPos: () => number | undefined;
  node: ProseMirrorNode;
  editor: Editor;
  extension: object;
}>();

const isCursorInTable = computed(() => {
  const nodePosition = props.getPos();
  if (nodePosition === undefined) return false;

  const selection = props.editor.state.selection;
  const currentPosCursor = selection.$from.start();
  return nodePosition <= currentPosCursor && currentPosCursor <= nodePosition + props.node.nodeSize;
});
</script>

<template>
  <NodeViewWrapper>
    <div class="table__wrapper">
      <NodeViewContent as="table" />

      <div v-show="isCursorInTable && editorStore.isEditable" class="table__settings-panel">
        <button class="table__settings-item" @click="editor.commands.addColumnAfter()">
          <IconTableColumnAdd class="table__settings-item_add-column" />
        </button>
        <button class="table__settings-item" @click="editor.commands.deleteColumn()">
          <IconTableColumnDelete class="table__settings-item_delete-column" />
        </button>
        <button class="table__settings-item" @click="editor.commands.addRowAfter()">
          <IconTableLineAdd class="table__settings-item_add-line" />
        </button>
        <button class="table__settings-item" @click="editor.commands.deleteRow()">
          <IconTableLineDelete class="table__settings-item_delete-line" />
        </button>
        <button class="table__settings-item" @click="deleteNode">
          <IconTableDelete class="table__settings-item_delete-table" />
        </button>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped lang="scss">
:deep(table) {
  border-collapse: collapse;
  margin: 0;
  overflow: hidden;
  table-layout: fixed;
  width: 100%;

  td,
  th {
    border: 1px solid var(--main-divider);
    box-sizing: border-box;
    min-width: 1em;
    padding: 6px 8px;
    position: relative;
    vertical-align: top;

    > * {
      margin-bottom: 0;
    }
  }

  td {
    padding: 20px;
  }

  th {
    background-color: var(--main-gray-bg);
    font-weight: bold;
    text-align: left;
  }
}

.table {
  &__wrapper {
    position: relative;
  }

  &__settings-panel {
    background: var(--main-black);
    position: absolute;
    left: 50%;
    bottom: -16px;
    transform: translateX(-50%);
    @include flex(a-center);
    z-index: 1;
    overflow: hidden;
    border-radius: 8px;
  }

  &__settings-item {
    position: relative;
    padding: 7.5px 12px;
    @include flex(a-center);
    gap: 4px;
    cursor: pointer;
    color: var(--main-white);
    border-left: 1px solid var(--surface-black-white-white-divider);
    z-index: 11;

    &:hover {
      background: var(--main-primary);
    }

    &_add-column {
      transform: rotate(180deg);
    }

    &_delete-column {
      transform: rotate(180deg);
    }

    &_add-line {
      transform: rotate(180deg);
    }

    &_delete-line {
      transform: rotate(180deg);
    }

    &_delete-table {
    }

    svg {
      fill: var(--main-white);
      width: 16px;
      height: 16px;
      transition: all 0.2s ease;
    }
  }
}
</style>
