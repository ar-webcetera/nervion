<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GitDiffFile, GitDiffResult } from '~/types/git';
import { highlightCode } from '~/utils/highlight';

const highlightLine = (content: string, f: GitDiffFile): string =>
  highlightCode(content, f.newPath || f.oldPath || '');

const props = withDefaults(
  defineProps<{
    diff: GitDiffResult;
    repoId?: number;
    headRef?: string;
  }>(),
  { repoId: 0, headRef: '' },
);

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);
const isImage = (f: GitDiffFile): boolean => {
  const p = (f.newPath || f.oldPath || '').toLowerCase();
  return IMAGE_EXT.has(p.split('.').pop() ?? '');
};
const rawUrl = (ref: string, path: string): string =>
  `/api/git/${props.repoId}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  additions: number;
  deletions: number;
  fileIndex?: number;
  children?: TreeNode[];
}

const STATUS_LABELS: Record<GitDiffFile['status'], string> = {
  added: 'добавлен',
  deleted: 'удалён',
  modified: 'изменён',
  renamed: 'переименован',
};

const filePath = (f: GitDiffFile): string => {
  if (f.status === 'renamed' && f.oldPath && f.newPath) return `${f.oldPath} → ${f.newPath}`;
  return f.newPath || f.oldPath || '';
};

const totals = computed(() => ({
  add: props.diff.files.reduce((s, f) => s + f.additions, 0),
  del: props.diff.files.reduce((s, f) => s + f.deletions, 0),
}));

// ---- дерево изменённых файлов (как в GitLab) ----
const buildTree = (files: GitDiffFile[]): TreeNode => {
  const root: TreeNode = { name: '', path: '', type: 'dir', additions: 0, deletions: 0, children: [] };
  files.forEach((f, idx) => {
    const segs = (f.newPath || f.oldPath || '').split('/').filter(Boolean);
    let node = root;
    root.additions += f.additions;
    root.deletions += f.deletions;
    segs.forEach((seg, i) => {
      const isFile = i === segs.length - 1;
      const path = segs.slice(0, i + 1).join('/');
      let child = node.children!.find((c) => c.name === seg && (c.type === 'file') === isFile);
      if (!child) {
        child = {
          name: seg,
          path,
          type: isFile ? 'file' : 'dir',
          additions: 0,
          deletions: 0,
          children: isFile ? undefined : [],
        };
        if (isFile) child.fileIndex = idx;
        node.children!.push(child);
      }
      child.additions += f.additions;
      child.deletions += f.deletions;
      node = child;
    });
  });
  compress(root);
  sortNode(root);
  return root;
};

const compress = (node: TreeNode) => {
  node.children?.forEach((child) => {
    while (
      child.type === 'dir' &&
      child.children &&
      child.children.length === 1 &&
      child.children[0].type === 'dir'
    ) {
      const only = child.children[0];
      child.name = `${child.name}/${only.name}`;
      child.path = only.path;
      child.children = only.children;
    }
    compress(child);
  });
};

const sortNode = (node: TreeNode) => {
  node.children?.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children?.forEach(sortNode);
};

const fileTree = computed(() => buildTree(props.diff.files));
const collapsed = ref<Set<string>>(new Set());
watch(
  () => props.diff,
  () => {
    collapsed.value = new Set();
  },
);

const treeRows = computed(() => {
  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    nodes.forEach((n) => {
      rows.push({ node: n, depth });
      if (n.type === 'dir' && n.children && !collapsed.value.has(n.path)) walk(n.children, depth + 1);
    });
  };
  walk(fileTree.value.children ?? [], 0);
  return rows;
});

const onTreeClick = (node: TreeNode) => {
  if (node.type === 'dir') {
    const set = new Set(collapsed.value);
    if (set.has(node.path)) set.delete(node.path);
    else set.add(node.path);
    collapsed.value = set;
    return;
  }
  if (node.fileIndex == null) return;
  const el = document.getElementById(`git-diff-file-${node.fileIndex}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
</script>

<template>
  <div class="git-diff">
    <div class="git-diff__summary">
      <div class="git-diff__summary-head">
        <span>Изменённые файлы · {{ diff.fileCount }}</span>
        <span class="git-diff__summary-stat">
          <span class="git-diff__stat-add">+{{ totals.add }}</span>
          <span class="git-diff__stat-del">−{{ totals.del }}</span>
        </span>
      </div>
      <button
        v-for="(row, i) in treeRows"
        :key="row.node.path + ':' + i"
        class="git-diff__tree-row"
        :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }"
        @click="onTreeClick(row.node)"
      >
        <span class="git-diff__tree-toggle">
          <svg
            v-if="row.node.type === 'dir'"
            class="git-diff__chevron"
            :class="{ 'git-diff__chevron_open': !collapsed.has(row.node.path) }"
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="git-diff__tree-name" :class="{ 'git-diff__tree-name_dir': row.node.type === 'dir' }">
          {{ row.node.name }}
        </span>
        <span class="git-diff__tree-stat">
          <span v-if="row.node.additions" class="git-diff__stat-add">+{{ row.node.additions }}</span>
          <span v-if="row.node.deletions" class="git-diff__stat-del">−{{ row.node.deletions }}</span>
        </span>
      </button>
    </div>

    <div
      v-for="(file, fi) in diff.files"
      :id="`git-diff-file-${fi}`"
      :key="fi"
      class="git-diff__file"
    >
      <div class="git-diff__file-head">
        <span class="git-diff__path">{{ filePath(file) }}</span>
        <span :class="['git-diff__status', `git-diff__status_${file.status}`]">
          {{ STATUS_LABELS[file.status] }}
        </span>
        <span class="git-diff__stat">
          <span class="git-diff__stat-add">+{{ file.additions }}</span>
          <span class="git-diff__stat-del">−{{ file.deletions }}</span>
        </span>
      </div>

      <template v-if="file.binary">
        <div v-if="isImage(file)" class="git-diff__images">
          <figure v-if="file.status !== 'added'" class="git-diff__image-fig">
            <figcaption class="git-diff__image-cap git-diff__image-cap_old">было</figcaption>
            <img
              class="git-diff__image"
              :src="rawUrl(headRef + '^', file.oldPath || file.newPath || '')"
              alt=""
              loading="lazy"
            />
          </figure>
          <figure v-if="file.status !== 'deleted'" class="git-diff__image-fig">
            <figcaption class="git-diff__image-cap git-diff__image-cap_new">стало</figcaption>
            <img
              class="git-diff__image"
              :src="rawUrl(headRef, file.newPath || file.oldPath || '')"
              alt=""
              loading="lazy"
            />
          </figure>
        </div>
        <div v-else class="git-diff__binary">Бинарный файл, изменения не показываются</div>
      </template>

      <div v-else class="git-diff__body">
        <template v-for="(hunk, hi) in file.hunks" :key="hi">
          <div class="git-diff__hunk-head">{{ hunk.header }}</div>
          <div
            v-for="(line, li) in hunk.lines"
            :key="li"
            :class="['git-diff__line', `git-diff__line_${line.type}`]"
          >
            <span class="git-diff__lineno">{{ line.oldNo ?? '' }}</span>
            <span class="git-diff__lineno">{{ line.newNo ?? '' }}</span>
            <span class="git-diff__sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : '' }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span class="git-diff__code" v-html="highlightLine(line.content, file)"></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.git-diff {
  @include flex(cn);
  gap: 16px;
  padding: 16px;

  &__summary {
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    overflow: hidden;
  }

  &__summary-head {
    @include flex(rn, between, a-center);
    padding: 10px 14px;
    background: var(--light-text-backgroung-primary-5);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
    @extend %text-s-medium;
  }

  &__summary-stat {
    @include flex(rn, a-center);
    gap: 8px;
    @extend %p12-medium;
  }

  &__tree-row {
    @include flex(rn, a-center);
    gap: 6px;
    width: 100%;
    padding-top: 6px;
    padding-bottom: 6px;
    padding-right: 14px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--light-text-backgroung-primary);
    @extend %p12-regular;

    &:hover {
      background: var(--light-text-backgroung-primary-5);
    }
  }

  &__tree-toggle {
    @include flex(center);
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    color: var(--light-text-backgroung-primary-50);
  }

  &__chevron {
    transition: transform 0.12s ease;

    &_open {
      transform: rotate(90deg);
    }
  }

  &__tree-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &_dir {
      color: var(--light-text-backgroung-primary-50);
    }
  }

  &__tree-stat {
    @include flex(rn, a-center);
    gap: 6px;
    flex: 0 0 auto;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }

  &__file {
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 12px;
    overflow: hidden;
    scroll-margin-top: 8px;
  }

  &__file-head {
    @include flex(rn, a-center);
    gap: 12px;
    padding: 10px 14px;
    background: var(--light-text-backgroung-primary-5);
    border-bottom: 1px solid var(--light-text-backgroung-primary-10);
  }

  &__path {
    @extend %text-s-medium;
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }

  &__status {
    @extend %p12-medium;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--light-text-backgroung-primary-10);
    color: var(--light-text-backgroung-primary-50);
    white-space: nowrap;

    &_added {
      color: var(--green);
    }
    &_deleted {
      color: var(--danger-delete);
    }
  }

  &__stat {
    @include flex(rn, a-center);
    gap: 8px;
    @extend %p12-medium;
    white-space: nowrap;
  }

  &__stat-add {
    color: var(--green);
  }
  &__stat-del {
    color: var(--danger-delete);
  }

  &__binary {
    padding: 14px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__images {
    @include flex(rw, a-start);
    gap: 16px;
    padding: 14px;
    background: var(--code-bg);
  }

  &__image-fig {
    @include flex(cn);
    gap: 6px;
    margin: 0;
    min-width: 0;
  }

  &__image-cap {
    @extend %p12-medium;

    &_old {
      color: var(--danger-delete);
    }
    &_new {
      color: var(--green);
    }
  }

  &__image {
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
    border: 1px solid var(--light-text-backgroung-primary-10);
    border-radius: 6px;
    // шахматка под прозрачные PNG
    background-image:
      linear-gradient(45deg, var(--code-checker) 25%, transparent 25%),
      linear-gradient(-45deg, var(--code-checker) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--code-checker) 75%),
      linear-gradient(-45deg, transparent 75%, var(--code-checker) 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  &__body {
    // редакторская тема Darcula (моноширинный код) — не из DS, оставлена как есть
    background: var(--code-bg);
    color: var(--code-fg);
    font-family: 'Fira Code', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.55;
    overflow-x: auto;
  }

  &__hunk-head {
    padding: 4px 14px;
    color: var(--code-number);
    background: var(--code-surface);
    white-space: pre;
  }

  &__line {
    @include flex(rn);
    align-items: stretch;
    white-space: pre;

    &_add {
      background: var(--green-10);
      box-shadow: inset 3px 0 0 var(--green);
    }
    &_del {
      background: var(--danger-delete-10);
      box-shadow: inset 3px 0 0 var(--danger-delete);
    }
  }

  &__lineno {
    flex: 0 0 auto;
    width: 44px;
    padding: 0 8px;
    text-align: right;
    color: var(--code-line);
    user-select: none;
  }

  &__sign {
    flex: 0 0 auto;
    width: 16px;
    text-align: center;
    user-select: none;
    color: var(--code-line);
  }

  &__code {
    flex: 1;
    padding-right: 14px;
  }

  // --- тема Darcula (JetBrains IDEA/WebStorm) ---
  :deep(.hljs-comment),
  :deep(.hljs-quote) {
    color: var(--code-muted);
    font-style: italic;
  }
  :deep(.hljs-keyword),
  :deep(.hljs-selector-tag),
  :deep(.hljs-literal),
  :deep(.hljs-section),
  :deep(.hljs-doctag) {
    color: var(--code-deleted);
  }
  :deep(.hljs-string),
  :deep(.hljs-regexp),
  :deep(.hljs-addition) {
    color: var(--code-string);
  }
  :deep(.hljs-number),
  :deep(.hljs-symbol),
  :deep(.hljs-bullet),
  :deep(.hljs-link) {
    color: var(--code-number);
  }
  :deep(.hljs-title),
  :deep(.hljs-title.function_),
  :deep(.hljs-function .hljs-title) {
    color: var(--code-keyword);
  }
  :deep(.hljs-meta),
  :deep(.hljs-meta-keyword) {
    color: var(--code-attr);
  }
  :deep(.hljs-attr),
  :deep(.hljs-property),
  :deep(.hljs-variable.constant_),
  :deep(.hljs-selector-attr) {
    color: var(--code-number);
  }
  :deep(.hljs-name),
  :deep(.hljs-selector-id),
  :deep(.hljs-selector-class) {
    color: var(--code-keyword);
  }
  :deep(.hljs-type),
  :deep(.hljs-built_in),
  :deep(.hljs-class .hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-variable),
  :deep(.hljs-template-variable),
  :deep(.hljs-attribute),
  :deep(.hljs-params) {
    color: var(--code-fg);
  }
}
</style>
