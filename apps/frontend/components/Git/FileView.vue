<script setup lang="ts">
import { computed } from 'vue';
import type { GitFileContent } from '~/types/git';
import { highlightCode } from '~/utils/highlight';

const props = defineProps<{
  file: GitFileContent;
  repoId?: number | null;
  gitRef?: string;
}>();

const isImage = computed(() => /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(props.file.path));
const rawUrl = computed(() =>
  props.repoId
    ? `/api/git/${props.repoId}/raw?ref=${encodeURIComponent(props.gitRef ?? "")}&path=${encodeURIComponent(props.file.path)}`
    : "",
);

const lineCount = computed(() => (props.file.content ?? '').split('\n').length);
const highlighted = computed(() => highlightCode(props.file.content ?? '', props.file.path));

const humanSize = computed(() => {
  const b = props.file.size;
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
});
</script>

<template>
  <div class="git-file">
    <div v-if="file.binary && isImage && rawUrl" class="git-file__image">
      <img :src="rawUrl" :alt="file.path" />
    </div>
    <div v-else-if="file.binary" class="git-file__notice">
      Бинарный файл ({{ humanSize }}) — предпросмотр недоступен
    </div>
    <div v-else-if="file.truncated" class="git-file__notice">
      Файл слишком большой ({{ humanSize }}) — предпросмотр отключён
    </div>
    <div v-else class="git-file__code">
      <div class="git-file__gutter">
        <span v-for="n in lineCount" :key="n">{{ n }}</span>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <pre class="git-file__pre"><code v-html="highlighted"></code></pre>
    </div>
  </div>
</template>

<style scoped lang="scss">
.git-file {
  height: 100%;

  &__notice {
    padding: 16px;
    color: var(--light-text-backgroung-primary-50);
    @extend %text-s-regular;
  }

  &__image {
    padding: 16px;
    overflow: auto;

    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
  }

  &__code {
    @include flex(rn, stretch);
    min-height: 100%;
    overflow: hidden;
    // редакторская тема Darcula (моноширинный код) — не из DS, оставлена как есть
    background: var(--code-bg);
    color: var(--code-fg);
    font-family: 'Fira Code', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.6;
  }

  &__gutter {
    flex: 0 0 auto;
    @include flex(cn);
    padding: 12px 0;
    background: var(--code-surface);
    color: var(--code-line);
    text-align: right;
    user-select: none;

    span {
      padding: 0 12px;
      line-height: 1.6;
    }
  }

  &__pre {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 12px 16px;
    overflow-x: auto;
    line-height: 1.6;

    code {
      font: inherit;
    }
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
