<script setup lang="ts">
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/vue-3';
import IconTableColumnAdd from '@/components/Icons/IconTableColumnAdd.vue';
import IconTableColumnDelete from '@/components/Icons/IconTableColumnDelete.vue';
import IconTableLineAdd from '@/components/Icons/IconTableLineAdd.vue';
import IconTableLineDelete from '@/components/Icons/IconTableLineDelete.vue';
import IconTableDelete from '@/components/Icons/IconTableDelete.vue';

const editorStore = useEditorStore();

const props = defineProps<NodeViewProps>();
const { editor, deleteNode, getPos } = props;

const wrapperRef = ref<HTMLElement | null>(null);

const updateColgroup = () => {
  const table = wrapperRef.value?.querySelector('table');
  if (!table) return;

  const firstRow = props.node.firstChild;
  if (!firstRow) return;

  const widths: number[] = [];
  for (let i = 0; i < firstRow.childCount; i++) {
    const cell = firstRow.child(i);
    const { colspan, colwidth } = cell.attrs as { colspan: number; colwidth: number[] | null };
    for (let j = 0; j < colspan; j++) {
      widths.push(colwidth?.[j] ?? 0);
    }
  }

  let colgroup = table.querySelector('colgroup');
  const needsRebuild = !colgroup || colgroup.children.length !== widths.length;

  if (needsRebuild) {
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, table.firstChild);
    } else {
      colgroup.innerHTML = '';
    }
    widths.forEach(() => colgroup!.appendChild(document.createElement('col')));
  }

  let totalWidth = 0;
  let hasExplicitWidths = true;
  widths.forEach((w, i) => {
    const col = colgroup!.children[i] as HTMLElement;
    if (w) {
      col.style.width = `${w}px`;
      totalWidth += w;
    } else {
      col.style.width = '';
      hasExplicitWidths = false;
    }
  });

  table.style.width = hasExplicitWidths ? `${totalWidth}px` : '';
};

watch(() => props.node, updateColgroup, { deep: true });
onMounted(updateColgroup);

const isCursorInTable = computed(() => {
  const selection = editor.state.selection;
  const currentPosCursor = selection.$from.start();
  const pos = getPos();
  if (!pos) {
    return false;
  }
  return pos <= currentPosCursor && currentPosCursor <= pos + props.node.nodeSize;
});
</script>

<template>
  <NodeViewWrapper>
    <div ref="wrapperRef" class="table__wrapper">
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

  td,
  th {
    border: 0.5px solid var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
    box-sizing: border-box;
    min-width: 50px;
    padding: 8px 12px;
    position: relative;
    vertical-align: top;

    > * {
      margin-bottom: 0;
    }
  }

  td {
    background-color: var(--light-text-backgroung-primary-5);
  }

  th {
    font-weight: bold;
    text-align: left;
  }
}

.table {
  &__wrapper {
    position: relative;
  }

  &__settings-panel {
    background: var(--black-50);
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
    border-left: 1px solid var(--light-text-backgroung-primary-5);
    z-index: 11;

    &:hover {
      background: var(--primary-100);
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
      fill: var(--white-100);
      width: 16px;
      height: 16px;
      transition: all 0.2s ease;
    }
  }
}
</style>
